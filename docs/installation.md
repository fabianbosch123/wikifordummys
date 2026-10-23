# Installation

Der Installer `install.sh` richtet wikifordummys auf einem Ubuntu-Server ein, egal ob gemieteter VPS oder eigener Server im Büro. Er fragt alles ab, was sich von Installation zu Installation unterscheidet (Domain, Art der Erreichbarkeit, Mailserver, Sicherungsziel), und schreibt daraus die Datei `.env`. Fest im Code steht nichts davon.

## Voraussetzungen

- Ubuntu 24.04 oder 22.04 (Server-Ausgabe genügt), Zugang per SSH mit einem Benutzer mit `sudo`
- Für 10 bis 20 Benutzer: 2 vCPU, 4 GB RAM, 40 GB SSD (Richtwert, nicht gemessen; mit 2 GB RAM klappt das Bauen der Images nur mit Swap)
- Eine Domain bzw. ein Name für das Wiki, z. B. `wiki.firma.de`
- Optional, aber empfohlen: ein SMTP-Zugang für Einladungen und „Passwort vergessen“, ein Ziel für die Sicherung (zweite Platte, NAS, SFTP-Server oder S3-Speicher)

Docker, restic, ufw und fail2ban installiert der Installer bei Bedarf selbst.

## Ablauf

```bash
sudo apt update && sudo apt install -y git
sudo git clone https://github.com/fabianbosch123/wikifordummys.git /opt/wikifordummys
cd /opt/wikifordummys
sudo ./install.sh
```

Das Repository ist privat; für `git clone` ein [Personal Access Token](https://github.com/settings/tokens) (nur Lesen) oder einen Deploy-Key verwenden.

Der Installer fragt nacheinander:

| Frage | Wozu |
| --- | --- |
| **Betriebsart** | Woher das HTTPS-Zertifikat kommt (siehe unten) |
| **Domain** | Adresse des Wikis; bei Let's Encrypt prüft der Installer, ob der DNS-Eintrag auf den Server zeigt |
| **Proxy** (nur Betriebsart „Proxy“) | Port, an den der vorhandene Proxy weiterleitet, und dessen IP-Adresse |
| **Mailversand** | SMTP-Server, Verschlüsselung (SSL/TLS, STARTTLS, keine), Port, Benutzer, Passwort, Absender. Der Installer prüft, ob der Port erreichbar ist, und schickt nach dem Start eine Testmail |
| **Erster Administrator** | E-Mail und Name; am Ende erscheinen Anmeldeadresse, E-Mail und ein Startpasswort (funktioniert auch ohne Mailversand; nach der Anmeldung 2FA einrichten und eigenes Passwort festlegen) |
| **Sicherung** | Ziel für restic, Push-Adresse zur Überwachung der Sicherung |
| **Überwachung** | Optionale Push-Adresse (Uptime Kuma, healthchecks.io), die alle 5 Minuten aufgerufen wird, solange alles läuft |
| **Absicherung** | Automatische Sicherheitsupdates, Firewall (ufw), fail2ban |

Danach zeigt er eine Zusammenfassung, schreibt `.env` (Rechte 600), baut und startet die Container, prüft API, Caddy und Mailversand, legt den Administrator an und richtet `wikictl` sowie die systemd-Timer ein. Ein Durchlauf dauert beim ersten Mal etwa 5 bis 10 Minuten, fast alles davon ist das Bauen der Images.

### Erneut ausführen

`sudo ./install.sh` (oder `sudo wikictl reconfigure`) lässt sich jederzeit erneut aufrufen, z. B. für eine neue Domain oder einen anderen Mailserver. Die bisherigen Werte werden vorgeschlagen; Enter übernimmt sie. Schlüssel und Passwörter (`ENCRYPTION_KEY`, Datenbank, Sicherung) bleiben erhalten, die vorherige Datei liegt als `.env.bak` daneben.

`sudo ./install.sh --config-only` schreibt nur `.env`, ohne etwas zu installieren oder zu starten.

## Betriebsarten

### 1. Öffentlich mit Let's Encrypt (`letsencrypt`)

Für einen VPS oder einen eigenen Server, der aus dem Internet erreichbar ist.

- DNS: A-Eintrag (und ggf. AAAA) der Domain auf die öffentliche IP des Servers. Bei einem eigenen Server hinter einem Router ist das die öffentliche IP des Routers.
- Ports 80 und 443 (TCP, 443 auch UDP für HTTP/3) müssen aus dem Internet erreichbar sein: bei VPS-Anbietern ggf. in deren Firewall freigeben, beim eigenen Server im Router auf den Server weiterleiten.
- Caddy holt und erneuert das Zertifikat selbst.

### 2. Nur im eigenen Netz (`internal`)

Für einen Server, der nur im Büro-Netz oder über VPN erreichbar ist. Let's Encrypt kann solche Server nicht prüfen; Caddy stellt das Zertifikat deshalb mit einer eigenen Zertifizierungsstelle aus.

- Der Name des Wikis muss im Netz auf den Server zeigen: im DNS des Routers bzw. Domain-Controllers, notfalls in der `hosts`-Datei der Geräte.
- Damit Browser nicht warnen, das Stammzertifikat einmal auf allen Geräten als vertrauenswürdig importieren:

  ```bash
  sudo wikictl ca-cert > wikifordummys-ca.crt
  ```

  Windows: Doppelklick → Zertifikat installieren → „Lokaler Computer“ → „Vertrauenswürdige Stammzertifizierungsstellen“ (per Gruppenrichtlinie auch für alle Rechner). macOS: in der Schlüsselbundverwaltung importieren und „Immer vertrauen“. Firefox nutzt eine eigene Liste (Einstellungen → Zertifikate). Android/iOS: Datei öffnen und als CA-Zertifikat installieren.
- Das Stammzertifikat liegt im Volume `caddy_data` und ist Teil der Sicherung; nach einer Wiederherstellung bleibt es gleich.

Alternativ lässt sich auch ein Server im eigenen Netz mit Let's Encrypt betreiben, wenn er unter einer öffentlichen Domain aus dem Internet erreichbar ist (Betriebsart 1).

### 3. Hinter einem vorhandenen Reverse Proxy (`proxy`)

Für Server, auf denen schon ein Webserver läuft (nginx, Apache, Traefik) oder wenn eine Firewall bzw. ein zentraler Proxy HTTPS übernimmt. Caddy spricht dann nur HTTP und lauscht auf einem freien Port (Standard `127.0.0.1:8080`, wenn der Proxy auf demselben Server läuft).

Der Proxy muss

- `https://<domain>` an `http://<WIKI_HTTP_PORT>` weiterleiten und dabei den `Host`-Header unverändert lassen,
- `X-Forwarded-For` mit der IP des Benutzers setzen (Rate-Limits, Audit-Log und Sperren hängen davon ab),
- Uploads bis zur Anhang-Grenze erlauben (Standard 50 MB),
- HTTP auf HTTPS umleiten.

Caddy übernimmt `X-Forwarded-For` nur von den Adressen in `WIKI_TRUSTED_PROXIES` (Standard: private Netze). So kann niemand von außen eine fremde IP vortäuschen.

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name wiki.firma.de;
    # ssl_certificate … wie bei den anderen Seiten

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_request_buffering off;
        # Nur für den Office-Editor nötig: WebSocket für die gemeinsame Bearbeitung
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}

# einmal im http-Block:
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

Apache (Module `proxy`, `proxy_http`, `headers`; für den Office-Editor zusätzlich `proxy_wstunnel` und `rewrite`):

```apache
<VirtualHost *:443>
    ServerName wiki.firma.de
    # SSLEngine on, SSLCertificateFile … wie bei den anderen Seiten
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8080/
    ProxyPassReverse / http://127.0.0.1:8080/
    RequestHeader set X-Forwarded-Proto https
    LimitRequestBody 52428800
    # Office-Editor: WebSocket weiterreichen
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule ^/(.*) ws://127.0.0.1:8080/$1 [P,L]
</VirtualHost>
```

Traefik (Datei-Provider):

```yaml
http:
  routers:
    wiki:
      rule: Host(`wiki.firma.de`)
      entryPoints: [websecure]
      service: wiki
      tls: { certResolver: letsencrypt }
  services:
    wiki:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: http://127.0.0.1:8080
```

Läuft der Proxy auf einem anderen Rechner, fragt der Installer dessen IP-Adresse ab und bindet Caddy an die IP dieses Servers im gemeinsamen Netz (z. B. `192.168.1.20:8080`). Achtung: Docker öffnet veröffentlichte Ports an ufw vorbei; deshalb nicht `0.0.0.0` verwenden, wenn der Server direkt im Internet hängt.

## Mailversand

Typische Zugänge (Stand der Anbieter-Dokumentation, bitte beim Anbieter prüfen):

| Anbieter | Server | Verschlüsselung / Port |
| --- | --- | --- |
| IONOS | `smtp.ionos.de` | SSL/TLS 465 oder STARTTLS 587 |
| Strato | `smtp.strato.de` | SSL/TLS 465 |
| Microsoft 365 | `smtp.office365.com` | STARTTLS 587 (SMTP AUTH muss für das Postfach erlaubt sein) |
| Gmail / Google Workspace | `smtp.gmail.com` | SSL/TLS 465, nur mit App-Passwort |
| Interner Mailserver ohne Anmeldung | z. B. `mail.firma.lan` | keine, Port 25 |

Die Absenderadresse muss zum Postfach passen, sonst lehnen die meisten Server den Versand ab. Manche VPS-Anbieter sperren ausgehende Mail-Ports für neue Kunden; der Installer meldet dann, dass der Port nicht erreichbar ist.

Den Zugang können Administratoren später auch in der Weboberfläche unter **Administration → E-Mail** ändern und dort eine Testmail schicken. Die Werte aus der Administration haben Vorrang vor `SMTP_URL` in `.env`; das Passwort wird mit `ENCRYPTION_KEY` verschlüsselt in der Datenbank gespeichert. „Auf .env zurücksetzen“ verwirft sie wieder.

## Ohne Rückfragen (automatisiert)

`sudo ./install.sh --non-interactive` nimmt die Antworten aus Umgebungsvariablen und bricht bei fehlenden Pflichtangaben ab. Die CI nutzt das für eine Probeinstallation bei jedem Push.

| Variable | Werte (Standard fett) |
| --- | --- |
| `WIKI_TLS` | **`letsencrypt`**, `internal`, `proxy` |
| `WIKI_DOMAIN` | Pflicht |
| `PROXY_SAME_HOST`, `WIKI_HTTP_PORT`, `WIKI_TRUSTED_PROXIES` | nur `proxy`; **`j`**, **`127.0.0.1:8080`**, IP-Adressen |
| `SMTP_ENABLE` | **`j`**, `n` |
| `SMTP_HOST`, `SMTP_SECURITY`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Server; **`tls`**, `starttls`, `none`; Port passend zur Verschlüsselung |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | Absender; **`Wiki`** |
| `ADMIN_CREATE`, `ADMIN_EMAIL`, `ADMIN_NAME` | **`j`** bei Neuinstallation |
| `OFFICE_ENABLE` | **`j`** (bei weniger als 7 GB Arbeitsspeicher **`n`**), `n`; siehe [Office-Editor](betrieb.md#office-editor) |
| `BACKUP_ENABLE`, `BACKUP_KIND`, `BACKUP_REPOSITORY` | **`j`**; **`local`**, `sftp`, `s3`, `rest`, `other`; Ziel |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_PING_URL` | nur bei S3; optional |
| `MONITOR_PING_URL` | optional |
| `INSTALL_UNATTENDED`, `INSTALL_UFW`, `INSTALL_FAIL2BAN` | `j`/`n` |

Beispiel:

```bash
sudo WIKI_TLS=letsencrypt WIKI_DOMAIN=wiki.firma.de \
  SMTP_HOST=smtp.ionos.de SMTP_SECURITY=tls SMTP_USER=wiki@firma.de SMTP_PASSWORD='…' \
  ADMIN_EMAIL=fabian@firma.de ADMIN_NAME=Fabian \
  BACKUP_KIND=s3 BACKUP_REPOSITORY=s3:https://fsn1.your-objectstorage.com/firma-backup/wiki \
  BACKUP_S3_ACCESS_KEY_ID=… BACKUP_S3_SECRET_ACCESS_KEY=… \
  ./install.sh --non-interactive
```

## Von Hand statt mit dem Installer

1. Docker Engine mit Compose-Plugin installieren ([Anleitung](https://docs.docker.com/engine/install/ubuntu/)).
2. `cp .env.example .env && chmod 600 .env`, Geheimnisse mit `openssl rand -hex 32` erzeugen und die Werte eintragen (Kommentare in der Datei).
3. `docker compose build && docker compose up -d`
4. `docker compose exec api node dist/cli.js create-admin --email … --name "…"` (gibt ein Startpasswort aus)
5. Optional `deploy/wikictl` nach `/usr/local/bin/wikictl` verlinken und die Units aus `deploy/systemd/` installieren.

Bestehende Installationen aus Meilenstein 1 bis 3 übernehmen ihre `.env` beim ersten Aufruf von `sudo ./install.sh`; die frühere Datei `deploy/Caddyfile` ist durch `deploy/caddy/` ersetzt. Wichtig: `smtp://` verlangt jetzt STARTTLS. Ein Mailserver ohne Verschlüsselung braucht `?tls=off` am Ende von `SMTP_URL`.
