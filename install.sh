#!/usr/bin/env bash
# wikifordummys: Installation und Neukonfiguration auf Ubuntu 22.04/24.04 (VPS oder eigener Server).
#
# Fragt Domain, Betriebsart (Let's Encrypt, nur internes Netz, hinter vorhandenem Proxy), Mailversand,
# ersten Administrator, Office-Editor und Sicherung ab, schreibt .env, startet das Wiki mit Docker Compose,
# prüft den Mailversand und richtet wikictl, Sicherung und Überwachung ein.
# Erneut aufgerufen ändert es die Konfiguration; Schlüssel und Passwörter bleiben dabei erhalten.
#
# Viele Variablen werden indirekt gelesen (${!name}), etwa beim Schreiben der .env:
# shellcheck disable=SC2034
set -Eeuo pipefail

# shellcheck source=deploy/lib.sh
source "$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)/deploy/lib.sh"

usage() {
  cat <<'EOF'
Verwendung: sudo ./install.sh [Optionen]

  --non-interactive   keine Rückfragen; Antworten kommen aus Umgebungsvariablen (siehe docs/installation.md)
  --config-only       nur .env schreiben, nichts installieren oder starten (kein root nötig)
  -h, --help          diese Hilfe

Ohne Optionen fragt das Skript alle Einstellungen ab und schlägt die bisherigen Werte vor.
EOF
}

NONINTERACTIVE=0
CONFIG_ONLY=0
while (($#)); do
  case $1 in
    --non-interactive | -y) NONINTERACTIVE=1 ;;
    --config-only) CONFIG_ONLY=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

trap 'die "Abbruch in Zeile $LINENO. Die Installation lässt sich gefahrlos erneut starten."' ERR

# ---------------------------------------------------------------------------
# Eingabe
# ---------------------------------------------------------------------------

# ask VAR "Frage" "Vorgabe" [Prüffunktion] [Fehlermeldung]
# Ohne Rückfragen gilt der Wert der gleichnamigen Umgebungsvariable, sonst die Vorgabe.
ask() {
  local __var=$1 prompt=$2 default=${3:-} check=${4:-} msg=${5:-Ungültige Eingabe.} answer
  while true; do
    if ((NONINTERACTIVE)); then
      answer=${!__var:-$default}
    else
      if [[ -n $default ]]; then
        read -r -p "$prompt [$default]: " answer || die "Eingabe beendet."
      else
        read -r -p "$prompt: " answer || die "Eingabe beendet."
      fi
      answer=${answer:-$default}
    fi
    answer=${answer#"${answer%%[![:space:]]*}"}
    answer=${answer%"${answer##*[![:space:]]}"}
    if [[ $answer == *"'"* ]]; then
      ((NONINTERACTIVE)) && die "$prompt: einfache Anführungszeichen sind nicht erlaubt."
      warn "Einfache Anführungszeichen sind nicht erlaubt."
      continue
    fi
    if [[ -z $check ]] || $check "$answer"; then
      printf -v "$__var" '%s' "$answer"
      return 0
    fi
    ((NONINTERACTIVE)) && die "$prompt: $msg ($answer)"
    warn "$msg"
  done
}

# ask_secret VAR "Frage" [behalten erlaubt: 1]
ask_secret() {
  local __var=$1 prompt=$2 keep=${3:-0} answer
  if ((NONINTERACTIVE)); then
    printf -v "$__var" '%s' "${!__var:-}"
    return 0
  fi
  if ((keep)); then prompt+=" (Enter = bisheriges behalten)"; fi
  read -r -s -p "$prompt: " answer || die "Eingabe beendet."
  echo
  printf -v "$__var" '%s' "$answer"
}

# ask_yes VAR "Frage" j|n → VAR=1 oder 0
ask_yes() {
  local __var=$1 prompt=$2 default=$3 answer
  if ((NONINTERACTIVE)); then
    answer=${!__var:-$default}
  else
    local hint='[j/N]'
    if [[ $default == j ]]; then hint='[J/n]'; fi
    read -r -p "$prompt $hint: " answer || die "Eingabe beendet."
    answer=${answer:-$default}
  fi
  case ${answer,,} in
    j | ja | y | yes | 1 | true) printf -v "$__var" 1 ;;
    *) printf -v "$__var" 0 ;;
  esac
}

# choose VAR "Frage" Vorgabe "wert1|Beschreibung" "wert2|Beschreibung" ...
choose() {
  local __var=$1 prompt=$2 default=$3 answer i
  shift 3
  local options=("$@")
  if ((NONINTERACTIVE)); then
    answer=${!__var:-$default}
    for i in "${options[@]}"; do
      if [[ ${i%%|*} == "$answer" ]]; then
        printf -v "$__var" '%s' "$answer"
        return 0
      fi
    done
    die "$prompt: unbekannter Wert '$answer'"
  fi
  info "$prompt"
  local n=1 def_n=1
  for i in "${options[@]}"; do
    info "  $n) ${i#*|}"
    if [[ ${i%%|*} == "$default" ]]; then def_n=$n; fi
    n=$((n + 1))
  done
  while true; do
    read -r -p "Auswahl [$def_n]: " answer || die "Eingabe beendet."
    answer=${answer:-$def_n}
    if [[ $answer =~ ^[0-9]+$ ]] && ((answer >= 1 && answer <= ${#options[@]})); then
      i=${options[answer - 1]}
      printf -v "$__var" '%s' "${i%%|*}"
      return 0
    fi
    warn "Bitte eine Zahl von 1 bis ${#options[@]} eingeben."
  done
}

not_empty() { [[ -n $1 ]]; }
optional_email() { [[ -z $1 ]] || valid_email "$1"; }
valid_host() { valid_domain "$1" || [[ $1 =~ ^[0-9.]+$ || $1 =~ ^[0-9A-Fa-f:]+$ ]]; }
valid_bind() { [[ $1 =~ ^(([0-9.]+|\[[0-9A-Fa-f:]+\]):)?[0-9]+$ ]] && valid_port "${1##*:}"; }
valid_url() { [[ -z $1 || $1 =~ ^https?://[^[:space:]]+$ ]]; }
valid_proxies() { [[ $1 == private_ranges || $1 =~ ^[0-9A-Fa-f:./[:space:]]+$ ]]; }
valid_from_name() { [[ $1 =~ ^[^\<\>\"]{1,80}$ ]]; }
valid_repo() { [[ $1 =~ ^(/|sftp:|s3:|rest:|b2:|azure:|gs:|rclone:)[^[:space:]]+$ ]]; }

# ---------------------------------------------------------------------------
# Bisherige Konfiguration
# ---------------------------------------------------------------------------

is_secret() { [[ ${#1} -ge 32 && $1 != bitte-* ]]; }
gen_secret() { openssl rand -hex 32; }

EXISTING=0
load_existing() {
  if [[ -f $ENV_FILE ]]; then
    EXISTING=1
    info "Vorhandene Konfiguration gefunden ($ENV_FILE); die bisherigen Werte werden vorgeschlagen."
  fi
  CUR_DOMAIN=$(env_get WIKI_DOMAIN)
  if [[ $CUR_DOMAIN == wiki.example.de ]]; then CUR_DOMAIN=''; fi
  CUR_TLS=$(env_get WIKI_TLS)
  CUR_HTTP_PORT=$(env_get WIKI_HTTP_PORT)
  CUR_HTTPS_PORT=$(env_get WIKI_HTTPS_PORT)
  CUR_TRUSTED=$(env_get WIKI_TRUSTED_PROXIES)
  CUR_SMTP_URL=$(env_get SMTP_URL)
  CUR_MAIL_FROM=$(env_get MAIL_FROM)
  CUR_BACKUP_REPOSITORY=$(env_get BACKUP_REPOSITORY)
  CUR_BACKUP_PASSWORD=$(env_get BACKUP_PASSWORD)
  CUR_S3_KEY=$(env_get BACKUP_S3_ACCESS_KEY_ID)
  CUR_S3_SECRET=$(env_get BACKUP_S3_SECRET_ACCESS_KEY)
  CUR_MONITOR=$(env_get MONITOR_PING_URL)
  CUR_OFFICE=$(env_get WIKI_OFFICE)
  CUR_BACKUP_PING=$(env_get BACKUP_PING_URL)

  # Bisherigen SMTP-Zugang zerlegen: smtp[s]://benutzer:passwort@server:port[?tls=off]
  CUR_SMTP_HOST='' CUR_SMTP_PORT='' CUR_SMTP_SECURITY='' CUR_SMTP_USER='' CUR_SMTP_PASS=''
  if [[ $CUR_SMTP_URL =~ ^(smtps?)://(([^:@/]*)(:([^@/]*))?@)?([^:/?]+)(:([0-9]+))?/?(\?(.*))?$ ]]; then
    CUR_SMTP_SECURITY=starttls
    if [[ ${BASH_REMATCH[1]} == smtps ]]; then CUR_SMTP_SECURITY=tls; fi
    if [[ ${BASH_REMATCH[10]} == *tls=off* ]]; then CUR_SMTP_SECURITY=none; fi
    CUR_SMTP_USER=$(urldecode "${BASH_REMATCH[3]}")
    CUR_SMTP_PASS=$(urldecode "${BASH_REMATCH[5]}")
    CUR_SMTP_HOST=${BASH_REMATCH[6]}
    CUR_SMTP_PORT=${BASH_REMATCH[8]}
  fi
  CUR_FROM_NAME='' CUR_FROM_ADDRESS=''
  if [[ $CUR_MAIL_FROM =~ ^(.*)\<([^\>]+)\>$ ]]; then
    CUR_FROM_NAME=${BASH_REMATCH[1]%" "}
    CUR_FROM_ADDRESS=${BASH_REMATCH[2]}
  elif [[ -n $CUR_MAIL_FROM ]]; then
    CUR_FROM_ADDRESS=$CUR_MAIL_FROM
  fi
  if [[ $CUR_FROM_ADDRESS == wiki@example.de ]]; then CUR_FROM_ADDRESS=''; fi
}

urldecode() {
  local s=${1//+/ }
  printf '%b' "${s//%/\\x}"
}

# ---------------------------------------------------------------------------
# Fragen
# ---------------------------------------------------------------------------

ask_mode() {
  step "Betriebsart"
  info "Wie wird das Wiki erreicht? Das legt fest, woher das HTTPS-Zertifikat kommt."
  choose WIKI_TLS "Betriebsart:" "${CUR_TLS:-letsencrypt}" \
    "letsencrypt|Öffentlich erreichbar (VPS oder eigener Server mit Portfreigabe 80/443), Zertifikat von Let's Encrypt" \
    "internal|Nur im eigenen Netz (Büro, VPN), Zertifikat von einer eigenen Zertifizierungsstelle" \
    "proxy|Hinter einem vorhandenen Reverse Proxy, der HTTPS übernimmt (nginx, Traefik, Firewall …)"
}

ask_domain() {
  step "Domain"
  case $WIKI_TLS in
    letsencrypt) info "Öffentliche Domain, deren DNS-Eintrag (A/AAAA) auf diesen Server bzw. den Router zeigt, z. B. wiki.firma.de." ;;
    internal) info "Name, unter dem das Wiki im eigenen Netz erreichbar ist (DNS im Netz oder Eintrag in der hosts-Datei), z. B. wiki.firma.lan." ;;
    proxy) info "Öffentliche Domain, unter der der vorhandene Proxy das Wiki ausliefert, z. B. wiki.firma.de." ;;
  esac
  ask WIKI_DOMAIN "Domain" "$CUR_DOMAIN" valid_domain "Bitte einen Domainnamen wie wiki.firma.de angeben (ohne https://)."
  WIKI_DOMAIN=${WIKI_DOMAIN,,}
  if [[ $WIKI_TLS == letsencrypt ]] && ((!CONFIG_ONLY)); then
    check_dns
  fi
}

check_dns() {
  local resolved public
  resolved=$(getent ahostsv4 "$WIKI_DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  public=$(curl -4 -fsS -m 5 https://api.ipify.org 2>/dev/null || true)
  if [[ -z $resolved ]]; then
    warn "Für $WIKI_DOMAIN gibt es (noch) keinen DNS-Eintrag. Let's Encrypt klappt erst, wenn er auf ${public:-die öffentliche IP} zeigt."
  elif [[ -n $public && " $resolved" != *" $public "* ]]; then
    warn "$WIKI_DOMAIN zeigt auf ${resolved% }, die öffentliche IPv4 dieses Servers ist $public."
    warn "Bei einem eigenen Server hinter einem Router: Ports 80 und 443 auf diesen Server weiterleiten."
  else
    ok "$WIKI_DOMAIN zeigt auf ${resolved% }."
  fi
}

ask_proxy() {
  if [[ $WIKI_TLS != proxy ]]; then
    WIKI_HTTP_PORT='' WIKI_HTTPS_PORT='' WIKI_TRUSTED_PROXIES='' WIKI_TRUST_PROXY_HOPS=''
    return 0
  fi
  step "Vorhandener Reverse Proxy"
  local same_host_default=j
  if [[ -n $CUR_TRUSTED && $CUR_TRUSTED != private_ranges ]]; then same_host_default=n; fi
  ask_yes PROXY_SAME_HOST "Läuft der Proxy auf diesem Server?" "$same_host_default"
  if ((PROXY_SAME_HOST)); then
    ask WIKI_HTTP_PORT "Adresse und Port, an die der Proxy weiterleitet" "${CUR_HTTP_PORT:-127.0.0.1:8080}" valid_bind "Format: 127.0.0.1:8080 oder 8080"
    WIKI_TRUSTED_PROXIES=private_ranges
  else
    ask WIKI_HTTP_PORT "Adresse und Port, an die der Proxy weiterleitet (IP dieses Servers im Netz des Proxys, z. B. 192.168.1.20:8080)" "${CUR_HTTP_PORT:-8080}" valid_bind "Format: 192.168.1.20:8080 oder 8080"
    ask WIKI_TRUSTED_PROXIES "IP-Adresse(n) des Proxys, durch Leerzeichen getrennt (z. B. 192.168.1.10/32)" "${CUR_TRUSTED:-}" valid_proxies "Bitte IP-Adressen oder Netze wie 192.168.1.10/32 angeben."
    [[ $WIKI_HTTP_PORT == *:* ]] || warn "Port $WIKI_HTTP_PORT ist auf allen Netzwerkkarten offen (Docker umgeht ufw); besser an die IP im Netz des Proxys binden."
  fi
  # HTTPS wird im Proxy-Betrieb nicht genutzt; nur lokal binden, damit der Port frei bleibt
  WIKI_HTTPS_PORT=127.0.0.1:8443
  WIKI_TRUST_PROXY_HOPS=2
  info "Der Proxy leitet https://$WIKI_DOMAIN per HTTP an $WIKI_HTTP_PORT weiter, setzt X-Forwarded-For"
  info "und erlaubt Uploads bis ${ATTACHMENT_MAX_MB:-50} MB (Beispiele in docs/installation.md)."
}

ask_smtp() {
  step "Mailversand (SMTP)"
  info "Das Wiki verschickt Einladungen und Links zum Zurücksetzen des Passworts. Den Zugang gibt es beim Mail-Anbieter"
  info "(z. B. IONOS, Strato, Microsoft 365, Gmail mit App-Passwort, Mailjet) oder beim eigenen Mailserver."
  info "Ohne Mailversand zeigt die Administration Einladungslinks zum Weitergeben an; „Passwort vergessen“ geht dann nicht."
  local default=j
  if ((EXISTING)) && [[ -z $CUR_SMTP_URL ]]; then default=n; fi
  ask_yes SMTP_ENABLE "Mailversand jetzt einrichten?" "$default"
  SMTP_URL='' MAIL_FROM=${CUR_MAIL_FROM:-}
  if ((!SMTP_ENABLE)); then
    [[ -n $MAIL_FROM ]] || MAIL_FROM="Wiki <wiki@$WIKI_DOMAIN>"
    return 0
  fi
  while true; do
    ask SMTP_HOST "SMTP-Server" "$CUR_SMTP_HOST" valid_host "Bitte einen Servernamen wie smtp.example.de angeben."
    choose SMTP_SECURITY "Verschlüsselung:" "${CUR_SMTP_SECURITY:-tls}" \
      "tls|SSL/TLS (meist Port 465)" \
      "starttls|STARTTLS (meist Port 587)" \
      "none|Keine (nur für einen Mailserver im eigenen Netz, meist Port 25)"
    local port_default
    case $SMTP_SECURITY in
      tls) port_default=465 ;;
      starttls) port_default=587 ;;
      none) port_default=25 ;;
    esac
    if [[ -n $CUR_SMTP_PORT && $SMTP_SECURITY == "$CUR_SMTP_SECURITY" ]]; then port_default=$CUR_SMTP_PORT; fi
    ask SMTP_PORT "Port" "$port_default" valid_port "Bitte eine Portnummer angeben."
    ask SMTP_USER "Benutzername (meist die E-Mail-Adresse; leer = ohne Anmeldung)" "$CUR_SMTP_USER"
    if [[ -n $SMTP_USER ]]; then
      local keep=0
      if [[ -n $CUR_SMTP_PASS && $SMTP_USER == "$CUR_SMTP_USER" ]]; then keep=1; fi
      ask_secret SMTP_PASSWORD "Passwort" "$keep"
      if [[ -z $SMTP_PASSWORD && $keep == 1 ]]; then SMTP_PASSWORD=$CUR_SMTP_PASS; fi
    else
      SMTP_PASSWORD=''
    fi
    local addr_default=${CUR_FROM_ADDRESS:-}
    if [[ -z $addr_default && $SMTP_USER == *@* ]]; then addr_default=$SMTP_USER; fi
    [[ -n $addr_default ]] || addr_default="wiki@$WIKI_DOMAIN"
    ask MAIL_FROM_ADDRESS "Absenderadresse (muss zum Postfach passen)" "$addr_default" valid_email "Bitte eine E-Mail-Adresse angeben."
    ask MAIL_FROM_NAME "Absendername" "${CUR_FROM_NAME:-Wiki}" valid_from_name "Bitte einen Namen ohne < > \" angeben."
    MAIL_FROM="$MAIL_FROM_NAME <$MAIL_FROM_ADDRESS>"

    local scheme=smtp query='' userinfo=''
    if [[ $SMTP_SECURITY == tls ]]; then scheme=smtps; fi
    if [[ $SMTP_SECURITY == none ]]; then query='?tls=off'; fi
    if [[ -n $SMTP_USER ]]; then userinfo="$(urlencode "$SMTP_USER"):$(urlencode "$SMTP_PASSWORD")@"; fi
    local host=$SMTP_HOST
    if [[ $host == *:* ]]; then host="[$host]"; fi
    SMTP_URL="$scheme://$userinfo$host:$SMTP_PORT$query"

    ((CONFIG_ONLY || NONINTERACTIVE)) && break
    # Schnelle Vorprüfung, ob der Port überhaupt erreichbar ist; Anmeldung und Versand testet das Wiki nach dem Start
    if timeout 8 bash -c "exec 3<>/dev/tcp/$SMTP_HOST/$SMTP_PORT" 2>/dev/null; then
      ok "$SMTP_HOST:$SMTP_PORT ist erreichbar."
      break
    fi
    warn "$SMTP_HOST:$SMTP_PORT ist von diesem Server aus nicht erreichbar."
    warn "Häufige Ursachen: Tippfehler, falscher Port oder der VPS-Anbieter sperrt ausgehende Mail-Ports (dann Port 587/465 oder Freischaltung beim Anbieter)."
    ask_yes SMTP_RETRY "Angaben korrigieren?" j
    ((SMTP_RETRY)) || break
    CUR_SMTP_HOST=$SMTP_HOST CUR_SMTP_SECURITY=$SMTP_SECURITY CUR_SMTP_PORT=$SMTP_PORT CUR_SMTP_USER=$SMTP_USER CUR_SMTP_PASS=$SMTP_PASSWORD
  done
}

ask_admin() {
  if ((CONFIG_ONLY)); then
    ADMIN_CREATE=0
    return 0
  fi
  step "Erster Administrator"
  local default=j
  if ((EXISTING)); then default=n; fi
  ask_yes ADMIN_CREATE "Administrator-Konto anlegen?" "$default"
  ((ADMIN_CREATE)) || return 0
  ask ADMIN_EMAIL "E-Mail-Adresse" "${ADMIN_EMAIL:-}" valid_email "Bitte eine E-Mail-Adresse angeben."
  ask ADMIN_NAME "Anzeigename" "${ADMIN_NAME:-Administrator}" valid_from_name "Bitte einen Namen ohne < > \" angeben."
}

ask_office() {
  step "Office-Editor"
  info "Mit Euro-Office lassen sich Word-, Excel- und PowerPoint-Anhänge (auch OpenDocument) direkt im Wiki"
  info "ansehen und gemeinsam bearbeiten; jedes Speichern legt eine neue Fassung des Anhangs an."
  info "Der Editor läuft als zusätzlicher Container unter https://$WIKI_DOMAIN/office/ und braucht etwa 4 GB Arbeitsspeicher mehr."
  local default=j mem_kb
  if [[ $CUR_OFFICE == false ]]; then default=n; fi
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
  if ((mem_kb > 0 && mem_kb < 7000000)); then
    warn "Dieser Server hat $((mem_kb / 1024 / 1024)) GB Arbeitsspeicher; für Wiki und Editor sind 8 GB empfohlen."
    if [[ -z $CUR_OFFICE ]]; then default=n; fi
  fi
  ask_yes OFFICE_ENABLE "Office-Editor einrichten?" "$default"
  if ((OFFICE_ENABLE)); then WIKI_OFFICE=true; else WIKI_OFFICE=false; fi
}

ask_backup() {
  step "Sicherung"
  info "Nächtliche, verschlüsselte Sicherung von Datenbank, Anhängen, Zertifikaten und .env mit restic"
  info "(7 tägliche, 4 wöchentliche, 6 monatliche Stände) an einen zweiten Ort, plus monatliche Test-Wiederherstellung."
  local default=j
  if ((EXISTING)) && [[ -z $CUR_BACKUP_REPOSITORY ]]; then default=n; fi
  ask_yes BACKUP_ENABLE "Sicherung einrichten?" "$default"
  if ((!BACKUP_ENABLE)); then
    BACKUP_REPOSITORY='' BACKUP_PASSWORD='' BACKUP_S3_ACCESS_KEY_ID='' BACKUP_S3_SECRET_ACCESS_KEY='' BACKUP_PING_URL=''
    return 0
  fi

  local kind_default=local
  case $CUR_BACKUP_REPOSITORY in
    sftp:*) kind_default=sftp ;;
    s3:*) kind_default=s3 ;;
    rest:*) kind_default=rest ;;
    '' | /*) kind_default=local ;;
    *) kind_default=other ;;
  esac
  choose BACKUP_KIND "Wohin soll gesichert werden?" "$kind_default" \
    "local|Verzeichnis auf diesem Server (zweite Platte, eingebundenes NAS oder USB-Platte)" \
    "sftp|Anderer Server oder NAS per SFTP/SSH" \
    "s3|S3-kompatibler Speicher (z. B. Hetzner, Wasabi, Backblaze, MinIO, AWS)" \
    "rest|restic REST-Server" \
    "other|Andere restic-Adresse direkt angeben"
  local cur=$CUR_BACKUP_REPOSITORY
  case $BACKUP_KIND in
    local)
      [[ $cur == /* ]] || cur=/mnt/backup/wikifordummys
      ask BACKUP_REPOSITORY "Verzeichnis" "$cur" valid_repo "Bitte einen absoluten Pfad angeben."
      ((CONFIG_ONLY)) || check_same_disk "$BACKUP_REPOSITORY"
      ;;
    sftp)
      [[ $cur == sftp:* ]] || cur=''
      info "Format: sftp:benutzer@server:/pfad (der Zugang läuft über einen SSH-Schlüssel von root)."
      ask BACKUP_REPOSITORY "SFTP-Ziel" "$cur" valid_repo "Format: sftp:benutzer@server:/pfad"
      ;;
    s3)
      [[ $cur == s3:* ]] || cur=''
      info "Format: s3:https://<endpunkt>/<bucket>/<pfad>, z. B. s3:https://fsn1.your-objectstorage.com/firma-backup/wiki"
      ask BACKUP_REPOSITORY "S3-Ziel" "$cur" valid_repo "Format: s3:https://endpunkt/bucket/pfad"
      ask BACKUP_S3_ACCESS_KEY_ID "Access Key ID" "$CUR_S3_KEY" not_empty "Bitte angeben."
      ask_secret BACKUP_S3_SECRET_ACCESS_KEY "Secret Access Key" "$([[ -n $CUR_S3_SECRET ]] && echo 1 || echo 0)"
      [[ -n $BACKUP_S3_SECRET_ACCESS_KEY ]] || BACKUP_S3_SECRET_ACCESS_KEY=$CUR_S3_SECRET
      ;;
    rest)
      [[ $cur == rest:* ]] || cur=''
      ask BACKUP_REPOSITORY "REST-Ziel (rest:https://benutzer:passwort@server:8000/wiki)" "$cur" valid_repo "Format: rest:https://…"
      ;;
    other)
      ask BACKUP_REPOSITORY "restic-Repository" "$cur" valid_repo "Unbekanntes Format."
      ;;
  esac
  if [[ $BACKUP_KIND != s3 ]]; then BACKUP_S3_ACCESS_KEY_ID='' BACKUP_S3_SECRET_ACCESS_KEY=''; fi
  # Ein vorhandenes Repository-Passwort nie ersetzen, sonst sind die bisherigen Sicherungen nicht mehr lesbar
  BACKUP_PASSWORD=${CUR_BACKUP_PASSWORD:-${BACKUP_PASSWORD:-}}
  if [[ -z $BACKUP_PASSWORD ]] && ((!NONINTERACTIVE)); then
    info "Neuer Server für ein vorhandenes Sicherungsziel (Umzug, Wiederherstellung)? Dann hier dessen Passwort eingeben."
    ask_secret BACKUP_PASSWORD "Passwort der vorhandenen Sicherung (Enter = neues Ziel, Passwort wird erzeugt)"
  fi
  if [[ -z $BACKUP_PASSWORD ]]; then
    BACKUP_PASSWORD=$(openssl rand -base64 30 | tr -d '/+=\n')
    NEW_BACKUP_PASSWORD=1
  fi
  ask BACKUP_PING_URL "Push-Adresse für die Überwachung der Sicherung (optional, z. B. healthchecks.io)" "$CUR_BACKUP_PING" valid_url "Bitte eine http(s)-Adresse angeben oder leer lassen."
}

check_same_disk() {
  local dir=$1 probe=$1
  while [[ ! -e $probe ]]; do probe=$(dirname "$probe"); done
  if [[ $(df --output=source "$probe" 2>/dev/null | tail -1) == "$(df --output=source /var/lib/docker 2>/dev/null | tail -1)" ]]; then
    warn "$dir liegt auf derselben Platte wie das Wiki. Fällt die Platte aus, ist auch die Sicherung weg."
    warn "Besser: zweite Platte, NAS oder ein Ziel außer Haus (SFTP, S3)."
  fi
}

ask_monitoring() {
  step "Überwachung"
  info "Das Wiki meldet seinen Zustand unter https://$WIKI_DOMAIN/api/v1/health (für Uptime Kuma, UptimeRobot u. ä.)."
  info "Zusätzlich kann der Server alle 5 Minuten eine Push-Adresse aufrufen, solange alles läuft; bleibt der Aufruf aus, meldet der Dienst den Ausfall."
  ask MONITOR_PING_URL "Push-Adresse (optional, z. B. Uptime Kuma Push oder healthchecks.io)" "$CUR_MONITOR" valid_url "Bitte eine http(s)-Adresse angeben oder leer lassen."
}

ask_system() {
  if ((CONFIG_ONLY)); then
    INSTALL_UNATTENDED=0 INSTALL_UFW=0 INSTALL_FAIL2BAN=0
    return 0
  fi
  step "Server absichern"
  ask_yes INSTALL_UNATTENDED "Automatische Sicherheitsupdates für Ubuntu aktivieren?" j
  local fw_default=j
  if [[ $WIKI_TLS == proxy ]]; then fw_default=n; fi
  ask_yes INSTALL_UFW "Firewall (ufw) einrichten: nur SSH, HTTP und HTTPS erlauben?" "$fw_default"
  local f2b_default=n
  if [[ $WIKI_TLS == letsencrypt ]]; then f2b_default=j; fi
  INSTALL_FAIL2BAN=${INSTALL_FAIL2BAN:-}
  if [[ $WIKI_TLS == proxy ]]; then
    # Hinter einem Proxy sieht die Firewall dieses Servers nur die IP des Proxys
    INSTALL_FAIL2BAN=0
  else
    ask_yes INSTALL_FAIL2BAN "fail2ban einrichten (sperrt IPs nach wiederholten Fehlanmeldungen)?" "$f2b_default"
  fi
}

summary() {
  step "Zusammenfassung"
  info "  Adresse:        https://$WIKI_DOMAIN"
  case $WIKI_TLS in
    letsencrypt) info "  Betriebsart:    öffentlich, Zertifikat von Let's Encrypt" ;;
    internal) info "  Betriebsart:    eigenes Netz, eigene Zertifizierungsstelle" ;;
    proxy) info "  Betriebsart:    hinter vorhandenem Proxy, HTTP auf $WIKI_HTTP_PORT, vertraute Proxys: $WIKI_TRUSTED_PROXIES" ;;
  esac
  if [[ -n $SMTP_URL ]]; then
    info "  Mailversand:    $SMTP_HOST:$SMTP_PORT ($SMTP_SECURITY), Absender $MAIL_FROM"
  else
    info "  Mailversand:    aus"
  fi
  if ((ADMIN_CREATE)); then info "  Administrator:  $ADMIN_NAME <$ADMIN_EMAIL>"; fi
  if [[ $WIKI_OFFICE == true ]]; then info "  Office-Editor:  an (https://$WIKI_DOMAIN/office/)"; else info "  Office-Editor:  aus"; fi
  if [[ -n $BACKUP_REPOSITORY ]]; then info "  Sicherung:      $BACKUP_REPOSITORY"; else info "  Sicherung:      aus"; fi
  if [[ -n $MONITOR_PING_URL ]]; then info "  Überwachung:    $MONITOR_PING_URL"; fi
  if ((!NONINTERACTIVE)); then
    echo
    ask_yes CONFIRM "Konfiguration schreiben und fortfahren?" j
    ((CONFIRM)) || die "Abgebrochen, nichts geändert."
  fi
}

# ---------------------------------------------------------------------------
# Umsetzen
# ---------------------------------------------------------------------------

write_env() {
  step "Konfiguration schreiben"
  if [[ ! -f $ENV_FILE ]]; then
    install -m 600 "$WIKI_DIR/.env.example" "$ENV_FILE"
  else
    cp -p "$ENV_FILE" "$ENV_FILE.bak"
    chmod 600 "$ENV_FILE.bak"
  fi
  chmod 600 "$ENV_FILE"
  local key
  # Geheimnisse nur erzeugen, wenn sie fehlen: ein neuer ENCRYPTION_KEY würde alle 2FA-Einrichtungen ungültig machen
  for key in DB_PASSWORD REDIS_PASSWORD ENCRYPTION_KEY SESSION_SECRET OFFICE_JWT_SECRET; do
    is_secret "$(env_get "$key")" || env_set "$key" "$(gen_secret)"
  done
  env_set WIKI_DOMAIN "$WIKI_DOMAIN"
  env_set WIKI_TLS "$WIKI_TLS"
  env_set WIKI_OFFICE "$WIKI_OFFICE"
  env_set SMTP_URL "$SMTP_URL"
  env_set MAIL_FROM "$MAIL_FROM"
  local pair
  for pair in WIKI_HTTP_PORT WIKI_HTTPS_PORT WIKI_TRUSTED_PROXIES WIKI_TRUST_PROXY_HOPS \
    BACKUP_REPOSITORY BACKUP_PASSWORD BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_PING_URL MONITOR_PING_URL; do
    if [[ -n ${!pair:-} ]]; then
      env_set "$pair" "${!pair}"
    elif [[ -n $(env_get "$pair") ]]; then
      env_set "$pair" ''
    fi
  done
  if ((EXISTING)); then
    ok ".env geschrieben (nur für den Besitzer lesbar), vorherige Fassung in .env.bak."
  else
    ok ".env geschrieben (nur für den Besitzer lesbar)."
  fi
}

preflight() {
  [[ $(id -u) -eq 0 ]] || die "Bitte mit sudo starten: sudo ./install.sh"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    if [[ ${ID:-} != ubuntu ]]; then
      warn "Getestet ist Ubuntu 22.04 und 24.04; gefunden: ${PRETTY_NAME:-unbekannt}. Fortfahren auf eigene Gefahr."
    fi
  fi
  local mem_kb
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  ((mem_kb >= 1800000)) || warn "Weniger als 2 GB Arbeitsspeicher; das Bauen der Images kann scheitern (Swap anlegen hilft)."
  local free_kb
  free_kb=$(df --output=avail "$WIKI_DIR" | tail -1)
  ((free_kb >= 5000000)) || warn "Weniger als 5 GB frei auf der Platte."
}

install_packages() {
  step "Pakete installieren"
  export DEBIAN_FRONTEND=noninteractive
  local pkgs=(ca-certificates curl openssl git)
  if [[ -n $BACKUP_REPOSITORY ]]; then pkgs+=(restic); fi
  if ((INSTALL_UNATTENDED)); then pkgs+=(unattended-upgrades); fi
  if ((INSTALL_UFW)); then pkgs+=(ufw); fi
  if ((INSTALL_FAIL2BAN)); then pkgs+=(fail2ban); fi
  local missing=() p
  for p in "${pkgs[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if ((${#missing[@]})); then
    apt-get update -qq
    apt-get install -y -qq "${missing[@]}" >/dev/null
  fi
  ok "Systempakete vorhanden."

  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    info "Installiere Docker Engine und Compose aus dem offiziellen Docker-Repository …"
    # shellcheck disable=SC1091
    . /etc/os-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${ID:-ubuntu}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID:-ubuntu} ${VERSION_CODENAME} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
    systemctl enable --now docker >/dev/null
  fi
  ok "Docker $(docker version -f '{{.Server.Version}}' 2>/dev/null) mit Compose $(docker compose version --short)."
}

check_ports() {
  [[ $WIKI_TLS == proxy ]] && return 0
  command -v ss >/dev/null 2>&1 || return 0
  local port
  for port in 80 443; do
    if ss -Hltn "sport = :$port" 2>/dev/null | grep -q . && ! compose ps -q caddy 2>/dev/null | grep -q .; then
      die "Port $port ist schon belegt ($(ss -Hltnp "sport = :$port" | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2)). Läuft bereits ein Webserver? Dann Betriebsart „hinter vorhandenem Proxy“ wählen."
    fi
  done
}

start_stack() {
  step "Wiki bauen und starten"
  check_ports
  if [[ ${WIKI_SKIP_BUILD:-0} != 1 ]]; then
    info "Baue die Images aus dem Quellcode (beim ersten Mal einige Minuten) …"
    compose build --pull
  fi
  if [[ $WIKI_OFFICE != true ]]; then
    # Abgeschalteter Editor: Container entfernen; das Profil muss dafür ausdrücklich genannt werden
    compose --profile office rm -sf office >/dev/null 2>&1 || true
  fi
  compose up -d --remove-orphans
  info "Warte auf die API (Datenbankmigrationen laufen beim Start) …"
  if ! wait_healthy 300; then
    compose ps
    compose logs --tail 40 api
    die "Die API ist nicht gesund geworden. Logs oben; nach Korrektur ./install.sh erneut starten."
  fi
  ok "API läuft."
  check_through_caddy
  check_office
}

# Der Editor braucht beim ersten Start einige Minuten (Schriften, interne Datenbank)
check_office() {
  [[ $WIKI_OFFICE == true ]] || return 0
  info "Warte auf den Office-Editor (beim ersten Start einige Minuten) …"
  local i state
  for i in $(seq 1 60); do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(compose ps -q office 2>/dev/null)" 2>/dev/null || true)
    if [[ $state == healthy ]]; then
      ok "Office-Editor läuft."
      return 0
    fi
    sleep 5
  done
  warn "Der Office-Editor ist noch nicht bereit; das Wiki funktioniert trotzdem. Details mit: wikictl logs office"
}

check_through_caddy() {
  local url opts=(-fsS -m 10 -o /dev/null --noproxy "*")
  case $WIKI_TLS in
    proxy)
      url="http://${WIKI_HTTP_PORT%:*}"
      [[ $WIKI_HTTP_PORT == *:* ]] || url="http://127.0.0.1"
      url+=":${WIKI_HTTP_PORT##*:}/api/v1/health"
      opts+=(-H "Host: $WIKI_DOMAIN")
      ;;
    internal) url="https://$WIKI_DOMAIN/api/v1/health" opts+=(-k --resolve "$WIKI_DOMAIN:443:127.0.0.1") ;;
    letsencrypt) url="https://$WIKI_DOMAIN/api/v1/health" opts+=(--resolve "$WIKI_DOMAIN:443:127.0.0.1") ;;
  esac
  local i
  for i in $(seq 1 20); do
    if curl "${opts[@]}" "$url" 2>/dev/null; then
      ok "Caddy liefert das Wiki aus."
      return 0
    fi
    sleep 3
  done
  if [[ $WIKI_TLS == letsencrypt ]]; then
    warn "Noch kein gültiges Zertifikat. Prüfen: DNS-Eintrag, Ports 80/443 aus dem Internet erreichbar (Router, Firewall des Anbieters)."
    warn "Caddy versucht es selbst weiter; Details mit: wikictl logs caddy"
  else
    warn "Caddy antwortet nicht wie erwartet; Details mit: wikictl logs caddy"
  fi
}

test_mail() {
  [[ -n $SMTP_URL ]] || return 0
  step "Mailversand prüfen"
  local to=${MAIL_TEST_TO:-${ADMIN_EMAIL:-}}
  if ((!NONINTERACTIVE)); then
    ask MAIL_TEST_TO "Testmail senden an (leer = nur Anmeldung prüfen)" "$to" optional_email "Bitte eine E-Mail-Adresse angeben."
    to=$MAIL_TEST_TO
  fi
  local args=(mail-test) out
  if [[ -n $to ]]; then args+=(--to "$to"); fi
  while true; do
    if out=$(compose exec -T api node dist/cli.js "${args[@]}" 2>&1); then
      ok "$out"
      return 0
    fi
    warn "${out#Fehler: }"
    ((NONINTERACTIVE)) && {
      warn "Mailversand später unter Administration → E-Mail korrigieren."
      return 0
    }
    ask_yes SMTP_FIX "SMTP-Angaben korrigieren und erneut testen?" j
    if ((!SMTP_FIX)); then
      warn "Weiter ohne funktionierenden Mailversand; korrigieren unter Administration → E-Mail oder mit ./install.sh."
      return 0
    fi
    CUR_SMTP_HOST=$SMTP_HOST CUR_SMTP_SECURITY=$SMTP_SECURITY CUR_SMTP_PORT=$SMTP_PORT CUR_SMTP_USER=$SMTP_USER CUR_SMTP_PASS=$SMTP_PASSWORD
    CUR_FROM_ADDRESS=$MAIL_FROM_ADDRESS CUR_FROM_NAME=$MAIL_FROM_NAME
    ask_smtp
    env_set SMTP_URL "$SMTP_URL"
    env_set MAIL_FROM "$MAIL_FROM"
    compose up -d api
    wait_healthy 180 || die "Die API startet nicht mehr; Logs mit: wikictl logs api"
  done
}

create_admin() {
  ((ADMIN_CREATE)) || return 0
  step "Administrator anlegen"
  local out
  if out=$(compose exec -T api node dist/cli.js create-admin --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" 2>&1); then
    # Startpasswort nur im Speicher halten und am Ende anzeigen, nirgends speichern
    ADMIN_PASSWORD=$(sed -n 's/^  Passwort: *//p' <<<"$out" | head -1)
    LOGIN_URL=$(sed -n 's/^  Anmeldung: *//p' <<<"$out" | head -1)
    ok "Administrator $ADMIN_EMAIL angelegt."
  else
    warn "${out#Fehler: }"
  fi
}

install_tools() {
  step "wikictl, Sicherung und Überwachung einrichten"
  ln -sf "$WIKI_DIR/deploy/wikictl" /usr/local/bin/wikictl
  chmod +x "$WIKI_DIR/deploy/wikictl" "$WIKI_DIR/install.sh"
  ok "Befehl wikictl installiert (wikictl help)."
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    local unit
    for unit in "$WIKI_DIR"/deploy/systemd/*.{service,timer}; do
      install -m 644 "$unit" /etc/systemd/system/
    done
    systemctl daemon-reload
    systemctl enable --now wikifordummys-monitor.timer >/dev/null
    if [[ -n $BACKUP_REPOSITORY ]]; then
      systemctl enable --now wikifordummys-backup.timer wikifordummys-restore-test.timer >/dev/null
      ok "Sicherung täglich um ca. 3:15 Uhr, Test-Wiederherstellung am 1. jedes Monats."
    else
      systemctl disable --now wikifordummys-backup.timer wikifordummys-restore-test.timer >/dev/null 2>&1 || true
    fi
  else
    warn "Kein systemd gefunden; Sicherung und Überwachung bitte per cron einrichten (wikictl backup, wikictl monitor)."
  fi
}

init_backup() {
  [[ -n $BACKUP_REPOSITORY ]] || return 0
  step "Sicherungsziel vorbereiten"
  if [[ $BACKUP_REPOSITORY == sftp:* ]]; then
    if [[ ! -f /root/.ssh/id_ed25519 ]]; then
      install -d -m 700 /root/.ssh
      ssh-keygen -q -t ed25519 -N '' -C "wikifordummys-backup@$(hostname)" -f /root/.ssh/id_ed25519
    fi
    info "Öffentlicher SSH-Schlüssel von root; auf dem Ziel in ~/.ssh/authorized_keys eintragen:"
    info "  $(cat /root/.ssh/id_ed25519.pub)"
    if ((!NONINTERACTIVE)); then
      read -r -p "Enter drücken, wenn der Schlüssel eingetragen ist … " _ || true
    fi
  fi
  if "$WIKI_DIR/deploy/wikictl" backup-init; then
    if ((!NONINTERACTIVE)); then
      ask_yes BACKUP_NOW "Erste Sicherung jetzt erstellen?" j
      if ((BACKUP_NOW)); then "$WIKI_DIR/deploy/wikictl" backup || warn "Erste Sicherung fehlgeschlagen; Details oben."; fi
    fi
  else
    warn "Das Sicherungsziel ist nicht erreichbar; nach Korrektur: wikictl backup-init"
  fi
}

harden() {
  if ((INSTALL_UNATTENDED)); then
    cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
    ok "Automatische Sicherheitsupdates aktiv."
  fi
  if ((INSTALL_UFW)); then
    local ssh_port
    ssh_port=$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}')
    ufw allow "${ssh_port:-22}/tcp" >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow 443/udp >/dev/null
    ufw --force enable >/dev/null
    ok "Firewall aktiv: SSH (Port ${ssh_port:-22}), 80, 443."
  fi
  if ((INSTALL_FAIL2BAN)); then
    install -m 644 "$WIKI_DIR/deploy/fail2ban/filter.d/wikifordummys.conf" /etc/fail2ban/filter.d/
    install -m 644 "$WIKI_DIR/deploy/fail2ban/jail.d/wikifordummys.local" /etc/fail2ban/jail.d/
    install -d /etc/systemd/system/fail2ban.service.d
    install -m 644 "$WIKI_DIR/deploy/fail2ban/fail2ban.service.d/wikifordummys.conf" /etc/systemd/system/fail2ban.service.d/
    systemctl daemon-reload
    systemctl enable fail2ban >/dev/null 2>&1 || true
    systemctl restart fail2ban
    ok "fail2ban sperrt IPs nach 10 Fehlanmeldungen in 10 Minuten für eine Stunde."
  fi
}

final_notes() {
  step "Fertig"
  info "Das Wiki läuft unter ${C_BOLD}https://$WIKI_DOMAIN${C_RESET}"
  if [[ -n ${ADMIN_PASSWORD:-} ]]; then
    echo
    info "${C_BOLD}Erste Anmeldung als Administrator${C_RESET} (funktioniert auch ohne Mailversand):"
    info "  Adresse:   ${LOGIN_URL:-https://$WIKI_DOMAIN/login}"
    info "  E-Mail:    $ADMIN_EMAIL"
    info "  Passwort:  ${C_BOLD}$ADMIN_PASSWORD${C_RESET}"
    info "Das Startpasswort wird nur jetzt angezeigt und nirgends gespeichert. Bei der Anmeldung wird die"
    info "Zwei-Faktor-Anmeldung eingerichtet, danach muss ein eigenes Passwort festgelegt werden."
    info "Passwort vergessen oder verloren: sudo wikictl reset-password --email $ADMIN_EMAIL"
  fi
  case $WIKI_TLS in
    internal)
      echo
      info "Interne Zertifizierungsstelle: Damit Browser nicht warnen, das Stammzertifikat auf den Geräten importieren:"
      info "  sudo wikictl ca-cert > wikifordummys-ca.crt"
      info "Außerdem muss $WIKI_DOMAIN im Netz auf diesen Server zeigen (DNS des Routers oder hosts-Datei)."
      ;;
    proxy)
      echo
      info "Im vorhandenen Proxy https://$WIKI_DOMAIN an http://$WIKI_HTTP_PORT weiterleiten (Host-Header erhalten,"
      info "X-Forwarded-For setzen, Uploads bis ${ATTACHMENT_MAX_MB:-50} MB erlauben). Beispiele: docs/installation.md"
      ;;
  esac
  if ((${NEW_BACKUP_PASSWORD:-0})); then
    echo
    warn "Passwort der Sicherung (steht in .env; zusätzlich außerhalb des Servers aufbewahren, z. B. im Passwortmanager):"
    info "  $BACKUP_PASSWORD"
  fi
  echo
  info "Weitere Schritte und Betrieb: docs/betrieb.md und docs/go-live.md"
  info "Status: wikictl status · Update: wikictl update · Sicherung: wikictl backup"
}

main() {
  if ((!CONFIG_ONLY)); then preflight; fi
  info "${C_BOLD}wikifordummys – Installation${C_RESET}"
  load_existing
  ask_mode
  ask_domain
  ask_proxy
  ask_smtp
  ask_admin
  ask_office
  ask_backup
  ask_monitoring
  ask_system
  summary
  write_env
  if ((CONFIG_ONLY)); then
    ok "Nur Konfiguration geschrieben. Starten mit: sudo ./install.sh (oder docker compose up -d)."
    return 0
  fi
  install_packages
  harden
  start_stack
  test_mail
  create_admin
  install_tools
  init_backup
  final_notes
}

main
