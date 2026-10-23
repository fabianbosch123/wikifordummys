# wikifordummys

Selbst gehostetes, Confluence-ähnliches Wiki mit integrierter Benutzerverwaltung für Ubuntu.
Ein kleines Team (10 bis 20 Personen) legt Wissen in Spaces als Seitenbaum an, pflegt es gemeinsam und findet es über die Volltextsuche.

**Stand: Meilenstein 3 (Rechte, Anhänge, Suche).** Benutzer, Gruppen, Einladungen, Login mit Pflicht-2FA, Sitzungen, Admin-Oberfläche und Audit-Log (M1), Spaces, Seitenbaum, Editor und Versionen (M2) sowie Rollen je Space, Seiteneinschränkungen, Anhänge und Volltextsuche (M3) sind fertig. Als Nächstes folgt der Go-live (M4).

## Inhalt

- [Funktionen in Meilenstein 1](#funktionen-in-meilenstein-1)
- [Funktionen in Meilenstein 2](#funktionen-in-meilenstein-2)
- [Funktionen in Meilenstein 3](#funktionen-in-meilenstein-3)
- [Aufbau](#aufbau)
- [Betrieb auf Ubuntu 24.04](#betrieb-auf-ubuntu-2404)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Tests](#tests)
- [Sicherheit](#sicherheit)
- [API](#api)
- [Nächste Meilensteine](#nächste-meilensteine)

## Funktionen in Meilenstein 1

- **Konten nur per Einladung.** Keine offene Registrierung. Der Einladungslink ist 72 Stunden gültig.
- **Erster Administrator per Kommandozeile**, ohne Standard-Passwort.
- **Pflicht-2FA für alle (TOTP).** Vor der Einrichtung gibt es keinen Zugriff auf Inhalte. Dazu 10 Wiederherstellungscodes, jeder einmal nutzbar.
- **Passwort vergessen** per Mail-Link (60 Minuten gültig). Die 2FA bleibt dabei bestehen.
- **Profil:** Anzeigename, Passwort ändern, angemeldete Geräte ansehen und abmelden, neue Wiederherstellungscodes.
- **Administration:** Benutzer einladen, deaktivieren, reaktivieren, Adminrechte vergeben, 2FA zurücksetzen, Sitzungen beenden; Gruppen anlegen und Mitglieder pflegen; Audit-Log mit Filter.
- Systemgruppen `alle-benutzer` (jedes aktive Konto automatisch) und `administratoren`. Konten werden deaktiviert statt gelöscht.

## Funktionen in Meilenstein 2

- **Spaces** mit Schlüssel (z. B. `IT`), Name, Beschreibung und Startseite; archivieren macht einen Space schreibgeschützt und blendet ihn in der Übersicht unter „Archiv“ aus.
- **Seitenbaum** beliebig tief, mit Brotkrumen; Seiten per Drag-and-drop im Baum oder über „Verschieben“ umsortieren und umhängen.
- **Editor (TipTap):** Überschriften, Fett/Kursiv/Durchgestrichen/Code, Listen, Zitate, Code-Blöcke, Tabellen, Bilder (per https-Adresse, ab M3 auch hochgeladen), Info-, Warn-, Erfolgs- und Notizboxen, Links und Links auf Wiki-Seiten. Gespeichert wird JSON, kein HTML.
- **Versionen:** Jede Speicherung ist eine unveränderliche Version. Verlauf mit zeilenweisem Vergleich zweier Versionen; alte Versionen lassen sich ansehen und als neue Version wiederherstellen.
- **Schutz vor Überschreiben:** Hat jemand anderes inzwischen gespeichert, meldet der Editor den Konflikt und bietet „Trotzdem speichern“ an; die andere Fassung bleibt im Verlauf.
- **Papierkorb:** Gelöschte Seiten samt Unterseiten bleiben 30 Tage wiederherstellbar und werden danach automatisch entfernt.
- Spaces anlegen darf, wer das globale Recht `create_space` hat (standardmäßig `alle-benutzer`).

## Funktionen in Meilenstein 3

- **Rollen je Space** für Gruppen und einzelne Personen: *Leser* sehen die Seiten, *Bearbeiter* legen Seiten an, ändern und verschieben sie und laden Anhänge hoch, *Space-Admins* verwalten zusätzlich Einstellungen, Rollen und den Papierkorb. Es gilt die höchste Rolle aus Person und Gruppen; die Gruppe `alle-benutzer` umfasst jedes aktive Konto. Wer keine Rolle hat, sieht den Space nicht (404). Systemadministratoren sind in jedem Space Admin. Gepflegt wird das unter **Space-Einstellungen → Rollen**.
- **Neue Spaces** sind standardmäßig offen (Ersteller Space-Admin, `alle-benutzer` Bearbeiter); beim Anlegen lässt sich das abwählen, dann sieht ihn zunächst nur der Ersteller. Bestehende Spaces aus Meilenstein 2 werden bei der Migration genau so eingerichtet, es ändert sich also nichts.
- **Seiteneinschränkungen** „Ansehen“ und „Bearbeiten“ auf Gruppen oder Personen, Schaltfläche **Einschränkungen** auf der Seite. Sie gelten für die Seite und alle Unterseiten und verengen nur: jede Einschränkung entlang des Pfads muss erfüllt sein. Eingeschränkte Seiten verschwinden für andere aus Baum, Suche und Anhängen (404). Space-Admins sind nicht eingeschränkt, damit keine Seite unerreichbar wird; Bearbeiter können sich nicht selbst aussperren.
- **Anhänge** je Seite (bis 50 MB, einstellbar über `ATTACHMENT_MAX_MB`): Bilder mit Vorschau, PDF öffnet im Browser, alles andere wird heruntergeladen. Im Editor lassen sich Bilder direkt hochladen und einbinden. Anhänge liegen im Volume `attachments` unter zufälligem Namen.
- **Volltextsuche** über Titel und Inhalt mit deutschem Wörterbuch (PostgreSQL), Suche nach Wortanfängen (`Druck` findet `Drucker`), Treffer hervorgehoben, Filter nach Space; immer nur über Seiten, die man sehen darf. Suchfeld oben in der Kopfzeile.

## Aufbau

```
apps/
  api/        NestJS-API (TypeScript), Prisma, PostgreSQL, Redis
  web/        Next.js-Weboberfläche (React)
packages/
  shared/     Gemeinsame Typen und Passwortregeln
e2e/          Ende-zu-Ende-Tests mit Playwright
deploy/       Caddyfile
docker-compose.yml       Betrieb (Caddy, Web, API, PostgreSQL, Redis)
docker-compose.dev.yml   Entwicklung (PostgreSQL, Redis, Mailpit)
```

Jede Anfrage läuft über Caddy: `/api/*` geht an die API, alles andere an die Weboberfläche. PostgreSQL und Redis hängen in einem internen Docker-Netz ohne Zugang nach außen; nur Caddy ist mit den Ports 80 und 443 erreichbar.

| Schicht | Wahl |
| --- | --- |
| Sprache | TypeScript, Node.js 22 LTS |
| Frontend | Next.js 15, React 19 |
| API | NestJS 11 |
| Datenbank | PostgreSQL 16 über Prisma 6 (versionierte Migrationen) |
| Sitzungen, Rate-Limits | Redis 7 |
| Anmeldung | argon2 (Argon2id), otplib (TOTP), helmet |
| Reverse Proxy | Caddy 2 mit automatischem Let’s-Encrypt-Zertifikat |
| Tests | Vitest (Unit und Integration), Playwright (Ende-zu-Ende) |

## Betrieb auf Ubuntu 24.04

Für 10 bis 20 Benutzer reicht ein Server oder VPS mit 2 vCPU, 4 GB RAM und 40 GB SSD (Richtwert, nicht gemessen).

### 1. Server vorbereiten

```bash
# Eigenen Benutzer mit sudo verwenden, SSH nur mit Schlüssel, Root-Login aus
sudo apt update && sudo apt upgrade -y
sudo apt install -y unattended-upgrades git
sudo dpkg-reconfigure -plow unattended-upgrades

# Firewall: nur SSH, HTTP und HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

### 2. Docker installieren

Docker Engine und das Compose-Plugin aus dem offiziellen Docker-Repository ([Anleitung](https://docs.docker.com/engine/install/ubuntu/)):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER   # danach einmal ab- und wieder anmelden
```

### 3. DNS

Einen DNS-Eintrag (A bzw. AAAA) für die gewünschte Domain, z. B. `wiki.example.de`, auf die öffentliche IP des Servers setzen. Caddy holt das Zertifikat beim ersten Start automatisch.

### 4. Code holen und konfigurieren

```bash
sudo mkdir -p /opt/wikifordummys && sudo chown $USER /opt/wikifordummys
git clone https://github.com/fabianbosch123/wikifordummys.git /opt/wikifordummys
cd /opt/wikifordummys

cp .env.example .env
chmod 600 .env
# Geheimnisse erzeugen und in .env eintragen (DB_PASSWORD, REDIS_PASSWORD, ENCRYPTION_KEY, SESSION_SECRET)
for i in 1 2 3 4; do openssl rand -hex 32; done
nano .env
```

Wichtig in `.env`:

- `WIKI_DOMAIN`: die Domain aus Schritt 3.
- `ENCRYPTION_KEY`: verschlüsselt die 2FA-Geheimnisse. **Sicher aufbewahren und nicht ändern**, sonst müssen alle Benutzer ihre 2FA neu einrichten.
- `SMTP_URL`: Zugang zum Mailserver, z. B. `smtps://benutzer:passwort@smtp.example.de:465`. Ohne SMTP zeigt die Admin-Oberfläche den Einladungslink zum Weitergeben an, aber „Passwort vergessen“ funktioniert dann nicht. Für den Betrieb daher einen Mailserver eintragen.

### 5. Starten

```bash
docker compose build        # baut die Images aus dem Quellcode (einige Minuten)
docker compose up -d
docker compose ps           # alle Dienste sollten "Up" bzw. "healthy" zeigen
```

Die API spielt beim Start die Datenbankmigrationen ein. Health-Check: `https://wiki.example.de/api/v1/health`.

### 6. Ersten Administrator anlegen

```bash
docker compose exec api node dist/cli.js create-admin --email fabian@example.de --name "Fabian"
```

Der Befehl gibt einen Einladungslink aus (72 Stunden gültig). Im Browser öffnen, Passwort festlegen, 2FA mit einer Authenticator-App einrichten (z. B. Aegis, Google Authenticator, Microsoft Authenticator, 1Password) und die Wiederherstellungscodes sichern. Danach lädt der Admin alle weiteren Personen über **Administration → Benutzer** ein.

### Update

```bash
cd /opt/wikifordummys
docker compose exec db pg_dump -U wiki wiki | gzip > ~/wiki-vor-update-$(date +%F).sql.gz
git pull
docker compose build
docker compose up -d
```

### Backup (vorläufig)

Bis zur automatischen Sicherung mit restic (Meilenstein 4) mindestens nächtlich die Datenbank sichern, z. B. per Cronjob:

```bash
docker compose -f /opt/wikifordummys/docker-compose.yml exec -T db pg_dump -U wiki wiki | gzip > /var/backups/wiki-$(date +%F).sql.gz
```

Die Anhänge liegen im Docker-Volume `attachments` und gehören ebenfalls ins Backup, z. B.:

```bash
docker run --rm -v wikifordummys_attachments:/data:ro -v /var/backups:/backup busybox tar czf /backup/wiki-anhaenge-$(date +%F).tar.gz -C /data .
```

Zusätzlich die Datei `.env` sicher (verschlüsselt) aufbewahren. Ohne `ENCRYPTION_KEY` sind die 2FA-Geheimnisse aus einem Backup nicht mehr nutzbar.

### Logs

```bash
docker compose logs -f api
```

Logs gehen auf stdout und werden von Docker auf 3 × 50 MB je Dienst begrenzt. Fehlgeschlagene Anmeldungen erscheinen zusätzlich als JSON-Zeile (`"audit":"auth.login.failed"` mit IP); darauf kann später fail2ban oder CrowdSec aufsetzen.

### Hinter einem vorhandenen Reverse Proxy

Gibt es schon einen Reverse Proxy, entfällt der Dienst `caddy`. Der vorhandene Proxy muss TLS übernehmen, `/api/*` an die API (Port 3001) und alles andere an die Weboberfläche (Port 3000) weiterleiten, den Header `X-Forwarded-For` setzen und die Security-Header aus `deploy/Caddyfile` ergänzen.

## Lokale Entwicklung

Voraussetzungen: Node.js 22, pnpm 10 (`corepack enable`), Docker.

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL, Redis, Mailpit
pnpm install
cp .env.example .env
```

In `.env` den Block „Nur lokale Entwicklung“ einkommentieren und `ENCRYPTION_KEY` sowie `SESSION_SECRET` setzen (`openssl rand -hex 32`). Dann:

```bash
pnpm --filter @wiki/shared build
pnpm --filter @wiki/api exec prisma migrate deploy   # liest DATABASE_URL aus der Umgebung
pnpm dev                                             # API auf :3001, Weboberfläche auf http://localhost:3000
pnpm --filter @wiki/api build && pnpm --filter @wiki/api cli create-admin --email ich@example.de --name "Ich"
```

Prisma liest `.env` nicht aus dem Wurzelverzeichnis; für Prisma-Befehle `DATABASE_URL` exportieren oder voranstellen. Mails landen in Mailpit unter http://localhost:8025.

Neue Migration nach Änderung von `apps/api/prisma/schema.prisma`:

```bash
cd apps/api && DATABASE_URL=postgresql://wiki:wiki@localhost:5432/wiki npx prisma migrate dev --name beschreibung
```

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm --filter @wiki/api test   # Unit- und Integrationstests gegen PostgreSQL und Redis
pnpm build && pnpm test:e2e    # Ende-zu-Ende im Browser (Chromium)
```

Die API-Tests nutzen die Datenbank `wiki_test` und Redis-DB 15, die Ende-zu-Ende-Tests `wiki_e2e` und Redis-DB 14; Entwicklungsdaten bleiben unberührt. Die Datenbanken werden bei Bedarf angelegt (der Datenbankbenutzer braucht das Recht `CREATEDB`). Abweichende Adressen über `TEST_DATABASE_URL`, `TEST_REDIS_URL`, `E2E_DATABASE_URL` und `E2E_REDIS_URL`. Für die Ende-zu-Ende-Tests muss Port 3001 frei sein; vorher ggf. `pnpm --filter @wiki/e2e exec playwright install chromium`.

Die CI (`.github/workflows/ci.yml`) führt bei jedem Push Linter, Typprüfung, alle Tests, `pnpm audit`, einen Secret-Scan (Gitleaks) und einen Container-Scan (Trivy) aus.

## Sicherheit

Die Anforderungen S1 bis S14 aus dem Architekturkonzept sind Abnahmekriterien. Umgesetzt und getestet sind:

| Nr. | Anforderung | Umsetzung | Nachweis |
| --- | --- | --- | --- |
| S1 | Passwort-Hashing | Argon2id (64 MiB, t=3), 12 bis 256 Zeichen, nie im Log | `password.service.spec.ts`, `auth.spec.ts` |
| S2 | 2FA für alle | TOTP Pflicht vor jedem Zugriff; Geheimnis AES-256-GCM-verschlüsselt; 10 gehashte Wiederherstellungscodes, je einmal nutzbar; jeder TOTP-Code nur einmal gültig | `auth.spec.ts`, `onboarding.spec.ts` (E2E) |
| S3 | Rate-Limiting | Login und 2FA: 5 pro Minute je IP und je Konto, danach steigende Sperre (1 min, 2 min, … bis 1 h); Passwort-Reset: 3 pro Stunde; API: 300 pro Minute je Benutzer | `auth.spec.ts` (429 mit `Retry-After`) |
| S4 | Sitzungen | Serverseitig in Redis (nur Hash der Session-ID); Cookie `__Host-session`, HttpOnly, Secure, SameSite=Lax; neue Session-ID nach Passwort und nach 2FA; 12 h Leerlauf, 14 Tage absolut; Passwortänderung beendet alle anderen Sitzungen | `auth.spec.ts` |
| S5 | CSRF | SameSite-Cookie plus Double-Submit-Token (`__Host-csrf` / Header `X-CSRF-Token`) bei allen ändernden Anfragen; Origin- und Referer-Prüfung | `auth.spec.ts` |
| S6 | XSS | Seiten als TipTap-JSON; die API lässt nur erlaubte Knoten, Marks und Attribute zu und prüft Link- und Bild-Adressen (kein `javascript:`, `data:` usw.); die Weboberfläche rendert nur diese Knoten als React-Elemente, ohne `dangerouslySetInnerHTML` (Linter-Regel); eingefügtes HTML wird mit DOMPurify bereinigt; Content-Security-Policy mit Nonce je Anfrage (`script-src 'self' 'nonce-…' 'strict-dynamic'`) | `content.spec.ts`, `pages.spec.ts` (API und E2E) |
| S7 | Uploads | Höchstgröße (Standard 50 MiB) in Caddy und API, Abbruch beim Streamen ohne Reste; Typ wird am Inhalt erkannt (PNG, JPEG, GIF, WebP, PDF), alles andere inklusive HTML und SVG ist `application/octet-stream` mit `Content-Disposition: attachment`; Ablage außerhalb des Web-Roots unter zufälligem Namen; Auslieferung nur mit Rechteprüfung, `nosniff` und `default-src 'none'` | `attachments.spec.ts` (HTML/SVG-Upload, Größe, Dateinamen), `m3.spec.ts` (E2E) |
| S8 | Autorisierung | Zentraler Guard („verweigern“ als Standard) plus `PermissionService` als einzige Stelle für Space-Rollen und Seiteneinschränkungen; ohne Rolle oder bei Ansehen-Einschränkung 404; Baum, Space-Liste, Suche und Anhänge nutzen dieselbe Prüfung | `rights.spec.ts`: jede Route mit jeder Rolle (keine, Leser, Bearbeiter, Admin) und mit Einschränkung; `pages.spec.ts`: ohne Anmeldung, ohne 2FA |
| S9 | Eingaben | Alle DTOs validiert, unbekannte Felder abgelehnt, Inhalte zusätzlich per Whitelist geprüft; nur parametrisierte SQL-Abfragen; Suchbegriffe werden auf Buchstaben und Ziffern reduziert, bevor sie in die tsquery gehen | `pages.spec.ts`, `rights.spec.ts`, `search.spec.ts` |
| S10 | Keine Konto-Ausforschung | Gleiche Antwort und gleiche Argon2-Arbeit bei unbekannter E-Mail (Login, Reset); Sperren gelten auch für unbekannte Adressen | `auth.spec.ts` |
| S12 | Audit-Log | Anmeldungen, Fehlversuche, Rechteänderungen (auch Space-Rollen und Seiteneinschränkungen), Admin-Aktionen, Spaces anlegen/ändern/archivieren, Seiten und Anhänge löschen, Seiten wiederherstellen, jeweils mit IP; nur anhängbar (Datenbank-Trigger); 365 Tage Aufbewahrung | `auth.spec.ts`, `admin.spec.ts`, `rights.spec.ts`, `attachments.spec.ts` |

Außerdem: Security-Header über Caddy und helmet (S11), Geheimnisse nur in `.env` plus Secret-Scan (S13), Renovate, `pnpm audit` und Trivy in der CI (S14). Bilder lassen sich weiterhin auch per https-Adresse einbinden; dabei sieht der fremde Server die IP-Adresse der Lesenden. Hochgeladene Bilder vermeiden das.

Lesende Zugriffe von Systemadministratoren werden nicht einzeln ins Audit-Log geschrieben (das Konzept sah das vor); Änderungen schon. Grund: jeder Seitenaufruf eines Admins würde sonst einen Eintrag erzeugen.

Hinweis zum Zurücksetzen der 2FA durch einen Admin: Danach kann sich die Person mit ihrem Passwort anmelden und die 2FA neu einrichten. Deshalb vorher die Identität der Person prüfen (z. B. telefonisch).

## API

Alle Routen liegen unter `/api/v1`. Fehler kommen einheitlich als `{ "error": { "code", "message" } }`.

| Methode und Pfad | Zweck | Zugriff |
| --- | --- | --- |
| `GET /auth/csrf` | CSRF-Token holen | öffentlich |
| `GET /auth/session` | Stand der Anmeldung | öffentlich |
| `POST /auth/login` | Passwort prüfen, Stufe „2FA ausstehend“ | öffentlich, gedrosselt |
| `POST /auth/2fa` | TOTP oder Wiederherstellungscode | nach Passwort |
| `POST /auth/2fa/setup`, `POST /auth/2fa/setup/confirm` | 2FA einrichten | nach Einladung bzw. 2FA-Reset |
| `POST /auth/logout` | Sitzung beenden | angemeldet |
| `GET /auth/invite/:token`, `POST /auth/invite/accept` | Einladung ansehen und annehmen | Einladungstoken |
| `POST /auth/password/forgot`, `POST /auth/password/reset` | Passwort zurücksetzen | öffentlich, gedrosselt |
| `GET/PATCH /me`, `POST /me/password` | Profil, Passwort | angemeldet |
| `GET/DELETE /me/sessions`, `DELETE /me/sessions/:id` | Sitzungen | angemeldet |
| `POST /me/2fa/recovery-codes` | Neue Wiederherstellungscodes | angemeldet |
| `GET/POST /admin/users`, `PATCH /admin/users/:id` | Einladen, Status, Adminrecht | Systemadmin |
| `POST /admin/users/:id/invite`, `POST /admin/users/:id/reset-2fa`, `DELETE /admin/users/:id/sessions` | Erneut einladen, 2FA zurücksetzen, abmelden | Systemadmin |
| `GET/POST /admin/groups`, `PATCH/DELETE /admin/groups/:id`, `PUT /admin/groups/:id/members` | Gruppen | Systemadmin |
| `GET /admin/audit` | Audit-Log | Systemadmin |
| `GET/POST /spaces`, `GET/PATCH /spaces/:key` | Spaces auflisten, anlegen, ändern, archivieren | angemeldet / `create_space` / Space-Admin |
| `GET /spaces/:key/tree`, `GET /spaces/:key/trash` | Seitenbaum, Papierkorb | Leser / Space-Admin |
| `POST /pages`, `GET/PUT/DELETE /pages/:id` | Seite anlegen, lesen, speichern (mit `version`, sonst 409), in den Papierkorb | Bearbeiter / Leser / Bearbeiter / Space-Admin |
| `POST /pages/:id/move`, `POST /pages/:id/undelete` | Verschieben, aus dem Papierkorb holen | Bearbeiter / Space-Admin |
| `GET /pages/:id/versions[/:version]`, `GET /pages/:id/diff?from=&to=`, `POST /pages/:id/restore/:version` | Verlauf, Vergleich, Wiederherstellen | Leser / Leser / Bearbeiter |
| `GET/PUT /spaces/:key/permissions` | Rollen im Space | Space-Admin |
| `GET/PUT /pages/:id/restrictions` | Seiteneinschränkungen (eigene und geerbte) | Leser / Bearbeiter |
| `GET /pages/:id/attachments`, `POST /pages/:id/attachments?filename=` | Anhänge auflisten, hochladen (Datei als Body, `application/octet-stream`) | Leser / Bearbeiter |
| `GET /attachments/:id[?download=1]`, `DELETE /attachments/:id` | Anhang abrufen, löschen | Leser / Bearbeiter |
| `GET /search?q=&space=&offset=` | Volltextsuche, nach Rechten gefiltert | angemeldet |
| `GET /directory` | Aktive Benutzer und Gruppen für die Rechtevergabe (ohne E-Mail) | angemeldet |
| `GET /health` | Datenbank, Redis, Speicherplatz | öffentlich |

## Nächste Meilensteine

| Meilenstein | Inhalt |
| --- | --- |
| M4 Go-live | Deployment, Backups mit restic, Monitoring, OWASP-ZAP-Scan, Pilotbetrieb |
| M5 Zusammenarbeit | Kommentare, Benachrichtigungen, Vorlagen, Labels; Hintergrund-Worker (BullMQ) für Mails und ggf. Volltext aus PDF-Anhängen |
| M6 Ausbau | Gleichzeitiges Bearbeiten, Export, API-Tokens, Webhooks |
