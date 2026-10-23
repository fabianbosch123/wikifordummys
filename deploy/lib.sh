# shellcheck shell=bash
# Gemeinsame Hilfsfunktionen für install.sh und wikictl. Wird mit `source` eingebunden.

WIKI_DIR=${WIKI_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
ENV_FILE=${ENV_FILE:-$WIKI_DIR/.env}
# Projektname aus docker-compose.yml (name:), Präfix der Volumes
# shellcheck disable=SC2034
COMPOSE_PROJECT=wikifordummys

if [[ -t 1 ]]; then
  C_BOLD=$'\e[1m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_RESET=$'\e[0m'
else
  C_BOLD='' C_RED='' C_GREEN='' C_YELLOW='' C_RESET=''
fi

info() { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
ok() { printf '%s✓ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
die() {
  printf '%sFehler: %s%s\n' "$C_RED" "$*" "$C_RESET" >&2
  exit 1
}

# Liest einen Wert aus .env, ohne die Datei als Shell-Code auszuführen.
# Versteht KEY=wert, KEY='wert' und KEY="wert"; Kommentare und Leerzeilen werden übersprungen.
env_get() {
  local key=$1 file=${2:-$ENV_FILE} line value
  [[ -f $file ]] || return 0
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1) || true
  [[ -n $line ]] || return 0
  value=${line#*=}
  if [[ $value == \'*\' ]]; then
    value=${value:1:${#value}-2}
  elif [[ $value == \"*\" ]]; then
    value=${value:1:${#value}-2}
  fi
  printf '%s' "$value"
}

# Setzt einen Wert in .env (ersetzt eine vorhandene Zeile oder hängt an); Werte stehen in einfachen Anführungszeichen
env_set() {
  local key=$1 value=$2 file=${3:-$ENV_FILE} tmp
  [[ $value != *"'"* ]] || die "Der Wert für $key darf kein einfaches Anführungszeichen enthalten."
  [[ $value != *$'\n'* ]] || die "Der Wert für $key darf keinen Zeilenumbruch enthalten."
  tmp=$(mktemp "$file.XXXXXX")
  chmod 600 "$tmp"
  if [[ -f $file ]]; then
    KEY="$key" VALUE="'$value'" awk '
      BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; done = 0 }
      $0 ~ "^[[:space:]]*" key "=" { if (!done) print key "=" value; done = 1; next }
      { print }
      END { if (!done) print key "=" value }
    ' "$file" >"$tmp"
  else
    printf "%s='%s'\n" "$key" "$value" >"$tmp"
  fi
  mv "$tmp" "$file"
}

# Docker Compose mit der Konfiguration aus .env; der Office-Editor (Profil office) läuft nur mit WIKI_OFFICE=true
compose() {
  local profile=()
  if [[ $(env_get WIKI_OFFICE) == true ]]; then profile=(--profile office); fi
  docker compose --project-directory "$WIKI_DIR" -f "$WIKI_DIR/docker-compose.yml" --env-file "$ENV_FILE" "${profile[@]}" "$@"
}

# Prozentkodierung für Benutzername und Passwort in SMTP_URL
urlencode() {
  local LC_ALL=C s=$1 out='' c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case $c in
      [a-zA-Z0-9.~_-]) out+=$c ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

valid_domain() {
  [[ ${#1} -le 253 && $1 =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || [[ $1 == localhost ]]
}

valid_email() {
  [[ $1 =~ ^[^[:space:]@\'\"\<\>]+@[^[:space:]@\'\"\<\>]+\.[^[:space:]@\'\"\<\>]+$ ]]
}

valid_port() {
  [[ $1 =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

# Wartet, bis die API gesund ist (Healthcheck des Containers); Ergebnis 0 = gesund
wait_healthy() {
  local timeout=${1:-180} waited=0 state
  while ((waited < timeout)); do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(compose ps -q api 2>/dev/null)" 2>/dev/null || true)
    [[ $state == healthy ]] && return 0
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# Caddy liest seine Konfiguration (deploy/caddy, als Volume eingebunden) nur beim Start. Nach Updates
# und Neukonfiguration neu laden, sonst gelten neue Routen und Header erst nach einem Neustart.
reload_caddy() {
  local tls
  tls=$(env_get WIKI_TLS)
  compose exec -T caddy caddy reload --config "/etc/caddy/${tls:-letsencrypt}.Caddyfile" --adapter caddyfile >/dev/null 2>&1 ||
    compose restart caddy >/dev/null
}

# Wartet auf den Office-Editor, falls eingeschaltet (beim ersten Start einige Minuten: Schriften, interne Datenbank)
wait_office() {
  [[ $(env_get WIKI_OFFICE) == true ]] || return 0
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

# Schaltet den Office-Editor in .env an oder aus; das JWT-Geheimnis wird nur erzeugt, wenn es fehlt
office_set() {
  local enable=$1 secret
  env_set WIKI_OFFICE "$enable"
  secret=$(env_get OFFICE_JWT_SECRET)
  if [[ ${#secret} -lt 32 || $secret == bitte-* ]]; then
    env_set OFFICE_JWT_SECRET "$(openssl rand -hex 32)"
  fi
}

# Arbeitsspeicher in GB (abgerundet) und ob er für Wiki plus Office-Editor reicht (8 GB empfohlen)
mem_gb() { awk '/MemTotal/ {print int($2 / 1024 / 1024)}' /proc/meminfo 2>/dev/null || echo 0; }
office_mem_ok() { (($(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) >= 7000000)); }

# Freier Platz in MB dort, wo Docker Images, Build-Cache und Volumes ablegt (Datenbank, Anhänge)
docker_free_mb() {
  local root free
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
  [[ -d ${root:-/var/lib/docker} ]] || root=/
  free=$(df -Pm "${root:-/var/lib/docker}" 2>/dev/null | awk 'NR == 2 {print $4}')
  printf '%s' "${free:-0}"
}

# Räumt auf, was Docker bei jedem Update anhäuft: Build-Cache und abgelöste Image-Stände.
# Volumes (Datenbank, Anhänge, Zertifikate) bleiben unberührt. Mit "all" auch der frische Build-Cache
# (das nächste Update baut dann länger), sonst bleibt der Cache der letzten 24 Stunden erhalten.
docker_cleanup() {
  if [[ ${1:-} == all ]]; then
    docker builder prune -af >/dev/null 2>&1 || true
  else
    docker builder prune -af --filter until=24h >/dev/null 2>&1 || true
  fi
  docker image prune -f >/dev/null 2>&1 || true
}

# Ruft eine Push-Adresse der Überwachung auf (Fehler werden ignoriert)
ping_url() {
  [[ -n $1 ]] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$1" || warn "Push-Adresse $1 nicht erreichbar."
}

# restic mit der Konfiguration aus .env
restic_env() {
  RESTIC_REPOSITORY=$(env_get BACKUP_REPOSITORY)
  RESTIC_PASSWORD=$(env_get BACKUP_PASSWORD)
  export RESTIC_REPOSITORY RESTIC_PASSWORD
  local key secret
  key=$(env_get BACKUP_S3_ACCESS_KEY_ID)
  secret=$(env_get BACKUP_S3_SECRET_ACCESS_KEY)
  if [[ -n $key ]]; then
    export AWS_ACCESS_KEY_ID=$key AWS_SECRET_ACCESS_KEY=$secret
  fi
  [[ -n $RESTIC_REPOSITORY && -n $RESTIC_PASSWORD ]]
}
