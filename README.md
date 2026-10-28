# wikifordummys

Selbst gehostetes, Confluence-ähnliches Wiki mit integrierter Benutzerverwaltung für Ubuntu.
Ein kleines Team (10 bis 20 Personen) legt Wissen in Spaces als Seitenbaum an, pflegt es gemeinsam und findet es über die Volltextsuche. Optional dazu: Office-Dokumente im Browser bearbeiten (Euro-Office), Zeichnungen mit draw.io und ein MCP-Server, über den Claude im Wiki liest und schreibt.

**Stand:** Meilensteine 1 bis 4 sind fertig (Benutzerverwaltung, Spaces und Editor, Rechte, Anhänge und Suche, Installer und Betrieb), dazu Office-Editor, draw.io und der MCP-Server. Offen ist der Pilotbetrieb nach [docs/go-live.md](docs/go-live.md); danach folgt Meilenstein 5 (Zusammenarbeit).

**Installation in Kürze** (Ubuntu 22.04/24.04, VPS oder eigener Server):

```bash
sudo git clone https://github.com/fabianbosch123/wikifordummys.git /opt/wikifordummys
cd /opt/wikifordummys && sudo ./install.sh
```

Der Installer fragt Domain, Betriebsart, Mailserver, ersten Administrator, Sicherungsziel und die optionalen Dienste ab.

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [docs/installation.md](docs/installation.md) | Voraussetzungen, Ablauf des Installers, Betriebsarten mit Proxy-Beispielen, Mail-Anbieter, Installation ohne Rückfragen oder von Hand |
| [docs/betrieb.md](docs/betrieb.md) | `wikictl`, Office-Editor, draw.io, Updates, Sicherung und Wiederherstellung, Überwachung, fail2ban, Platte voll |
| [docs/mcp.md](docs/mcp.md) | MCP-Server einrichten (claude.ai, Claude Code, Claude Desktop), Werkzeuge, Fehlersuche |
| [docs/go-live.md](docs/go-live.md) | Abnahme-Checkliste und Pilotbetrieb |

## Inhalt

- [Benutzer und Anmeldung](#benutzer-und-anmeldung)
- [Spaces, Seiten und Editor](#spaces-seiten-und-editor)
- [Rechte und Suche](#rechte-und-suche)
- [Anhänge](#anhänge)
- [Office-Editor (optional)](#office-editor-optional)
- [Zeichnungen mit draw.io (optional)](#zeichnungen-mit-drawio-optional)
- [Claude und KI-Assistenten (MCP)](#claude-und-ki-assistenten-mcp)
- [Installation und Betrieb](#installation-und-betrieb)
- [Aufbau](#aufbau)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Tests](#tests)
- [Sicherheitskonzept](#sicherheitskonzept)
- [API](#api)
- [Nächste Meilensteine](#nächste-meilensteine)

## Benutzer und Anmeldung

- **Konten nur per Einladung.** Keine offene Registrierung; der Einladungslink ist 72 Stunden gültig. Ohne Mailserver zeigt die Administration den Link an.
- **Erster Administrator per Kommandozeile** (`wikictl create-admin`), ohne Standard-Passwort: Die Shell zeigt ein Startpasswort, das nach der ersten Anmeldung geändert werden muss. Mit `--invite` kommt stattdessen ein Einladungslink per Mail. `wikictl reset-password` setzt ein Passwort ohne Mailversand zurück.
- **Pflicht-2FA für alle (TOTP).** Vor der Einrichtung gibt es keinen Zugriff auf Inhalte. Dazu 10 Wiederherstellungscodes, jeder einmal nutzbar.
- **Passwort vergessen** per Mail-Link (60 Minuten gültig). Die 2FA bleibt dabei bestehen.
- **Profil:** Anzeigename, Passwort ändern, angemeldete Geräte ansehen und abmelden, neue Wiederherstellungscodes, API-Tokens für den MCP-Server.
- **Administration:** Benutzer einladen, deaktivieren, reaktivieren, Adminrechte vergeben, 2FA zurücksetzen, Sitzungen beenden; Gruppen anlegen und Mitglieder pflegen; Mailversand einrichten; MCP-Server ein- und ausschalten; Audit-Log mit Filter.
- Systemgruppen `alle-benutzer` (jedes aktive Konto automatisch) und `administratoren`. Konten werden deaktiviert statt gelöscht.

## Spaces, Seiten und Editor

- **Spaces** mit Schlüssel (z. B. `IT`), Name, Beschreibung und Startseite. Archivieren macht einen Space schreibgeschützt und blendet ihn in der Übersicht unter „Archiv“ aus. Spaces anlegen darf, wer das globale Recht `create_space` hat (standardmäßig `alle-benutzer`).
- **Seitenbaum** beliebig tief, mit Brotkrumen, in einer Seitenleiste links (etwa 20 % der Breite); der Inhalt nutzt die volle restliche Breite. Seiten lassen sich per Drag-and-drop im Baum oder über „Verschieben“ umsortieren und umhängen.
- **Editor (TipTap):** Überschriften, Fett, Kursiv, Unterstrichen, Durchgestrichen, Code, Listen, Zitate, Code-Blöcke, Trennlinien, Tabellen, Bilder, Info-, Warn-, Erfolgs- und Notizboxen, Links und Links auf Wiki-Seiten. Bilder lassen sich an den Ecken, Tabellenspalten am Spaltenrand in der Größe ziehen. Gespeichert wird JSON, kein HTML.
- **Drag & Drop und Zwischenablage:** Bilder und Dateien lassen sich in den Text ziehen oder einfügen. Bilder erscheinen als Bild, andere Dateien als Link auf den Anhang; bei neuen Seiten wird beim Anlegen hochgeladen.
- **Versionen:** Jede Speicherung ist eine unveränderliche Version. Verlauf mit zeilenweisem Vergleich zweier Versionen; alte Versionen lassen sich ansehen und als neue Version wiederherstellen.
- **Schutz vor Überschreiben:** Hat jemand anderes inzwischen gespeichert, meldet der Editor den Konflikt und bietet „Trotzdem speichern“ an; die andere Fassung bleibt im Verlauf.
- **Papierkorb:** Gelöschte Seiten samt Unterseiten bleiben 30 Tage wiederherstellbar und werden danach automatisch entfernt.

## Rechte und Suche

- **Rollen je Space** für Gruppen und einzelne Personen: *Leser* sehen die Seiten, *Bearbeiter* legen Seiten an, ändern und verschieben sie und laden Anhänge hoch, *Space-Admins* verwalten zusätzlich Einstellungen, Rollen und den Papierkorb. Es gilt die höchste Rolle aus Person und Gruppen. Wer keine Rolle hat, sieht den Space nicht (404). Systemadministratoren sind in jedem Space Admin. Gepflegt wird das unter **Space-Einstellungen → Rollen**.
- **Neue Spaces** sind standardmäßig offen (Ersteller Space-Admin, `alle-benutzer` Bearbeiter); beim Anlegen lässt sich das abwählen, dann sieht ihn zunächst nur der Ersteller.
- **Seiteneinschränkungen** „Ansehen“ und „Bearbeiten“ auf Gruppen oder Personen, Schaltfläche **Einschränkungen** auf der Seite. Sie gelten für die Seite und alle Unterseiten und verengen nur: jede Einschränkung entlang des Pfads muss erfüllt sein. Eingeschränkte Seiten verschwinden für andere aus Baum, Suche und Anhängen (404). Space-Admins sind nicht eingeschränkt, damit keine Seite unerreichbar wird; Bearbeiter können sich nicht selbst aussperren.
- **Volltextsuche** über Titel, Inhalt und Beschriftungen von Zeichnungen mit deutschem Wörterbuch (PostgreSQL), Suche nach Wortanfängen (`Druck` findet `Drucker`), Treffer hervorgehoben, Filter nach Space; immer nur über Seiten, die man sehen darf. Suchfeld oben in der Kopfzeile.

## Anhänge

- **Anhänge je Seite** bis 50 MB (einstellbar über `ATTACHMENT_MAX_MB`): Bilder mit Vorschau, PDF öffnet im Browser, Office-Dateien im Office-Editor (falls eingeschaltet), alles andere wird heruntergeladen.
- **Panel rechts** neben dem Seiteninhalt mit der Kopfzeile „Anhänge (n)“ zum Auf- und Zuklappen. Zugeklappt bekommt der Inhalt die volle Breite; der Zustand wird je Browser gemerkt. Auf schmalen Bildschirmen (unter 1000 px) steht das Panel unter dem Inhalt.
- **Fassungen:** Office-Editor und draw.io legen beim Speichern eine neue Fassung des Anhangs an; ältere Fassungen bleiben herunterladbar.
- **Schutz vor voller Platte:** Uploads werden abgelehnt, wenn danach weniger als 2 GB frei wären; dazu ein Tageskontingent und eine stündliche Höchstzahl je Benutzer (`ATTACHMENT_MIN_FREE_MB`, `ATTACHMENT_QUOTA_MB_PER_DAY`, `RATE_UPLOADS_PER_HOUR` in `.env`).
- Anhänge liegen im Volume `attachments` unter zufälligem Namen und sind Teil der Sicherung.

## Office-Editor (optional)

- **Euro-Office** (AGPL-3.0, europäischer Fork von ONLYOFFICE Docs) zum Ansehen und gemeinsamen Bearbeiten von Word-, Excel- und PowerPoint-Anhängen (DOCX, XLSX, PPTX und OpenDocument; DOC, XLS und PPT nur ansehen) direkt im Wiki, unter `/office/` auf derselben Domain.
- **Neue Office-Dateien aus dem Seiteneditor:** „＋ Office-Datei“ in der Werkzeugleiste legt ein leeres Word-Dokument, eine Excel-Tabelle oder eine PowerPoint-Präsentation als Anhang der Seite an, setzt einen Link an die Cursorposition und öffnet die Datei in einem neuen Tab im Office-Editor. Ist der Office-Editor ausgeschaltet, fehlt der Knopf.
- **Fassungen:** Jedes Speichern im Editor legt eine neue Fassung des Anhangs an; ältere Fassungen bleiben zum Herunterladen erhalten.
- **Sicherheit:** signierte Konfiguration und Rückrufe (JWT, gemeinsames Geheimnis), kurzlebige Datei-Links, Editor-Server ohne Internetzugang, Download-Adressen aus Rückrufen nur vom eigenen Editor-Server (Schutz vor SSRF), Typprüfung am Inhalt. Details in [docs/betrieb.md](docs/betrieb.md#office-editor).
- Braucht etwa 2 CPU-Kerne und 4 GB Arbeitsspeicher zusätzlich (Server mit 8 GB empfohlen). Der Installer fragt, ob er laufen soll; später `sudo wikictl office on|off`, Prüfung mit `sudo wikictl office-check`.

## Zeichnungen mit draw.io (optional)

- **draw.io** (diagrams.net, Apache-2.0) im Seiteneditor: Knopf **◇ Zeichnung** fügt eine Zeichnung ein, z. B. einen Netzwerkplan (Formen für Netzwerk, Rack und Cisco sind gleich in der Seitenleiste). **✎ Zeichnung bearbeiten** oder Doppelklick öffnet sie wieder. Läuft selbst gehostet unter `/draw/`, ohne externe Dienste und abgeschottet in einem eigenen Rahmen.
- **Speicherung:** als PNG-Anhang der Seite mit eingebetteten draw.io-Daten (lässt sich auch in draw.io Desktop öffnen). Die Seite verweist auf genau die Fassung, die beim Speichern der Seite aktuell war, damit ältere Seitenversionen die damalige Zeichnung zeigen. Beschriftungen sind über die Suche auffindbar.
- Klein (etwa 150 MB Platz, kaum Arbeitsspeicher) und standardmäßig an. Der Installer fragt, ob es laufen soll; später `sudo wikictl drawio on|off`. Abgeschaltet bleiben vorhandene Zeichnungen als Bild sichtbar. Details in [docs/betrieb.md](docs/betrieb.md#zeichnungen-mit-drawio).

## Claude und KI-Assistenten (MCP)

- **MCP-Server** unter `/api/v1/mcp`: Claude (claude.ai mit App und Projekten, Claude Code, Claude Desktop) liest und durchsucht das Wiki, legt Seiten aus Markdown an, ändert oder ergänzt sie und erstellt oder ersetzt draw.io-Zeichnungen aus XML. Löschen, Verschieben, Rechte und Administration gibt es über MCP bewusst nicht. Standardmäßig aus; ein Administrator schaltet ihn unter **Administration → Claude (MCP)** ein.
- **API-Tokens** für Claude Code und Claude Desktop legt jeder Benutzer im Profil an (mit 2FA-Code, höchstens ein Jahr gültig, standardmäßig nur lesen, wahlweise lesen und schreiben).
- **Connector in claude.ai:** Das Wiki wird als eigener Connector eingetragen; die Anmeldung läuft per OAuth über eine Zustimmungsseite im Wiki (mit 2FA-Code), ganz ohne Token. Voraussetzung ist ein öffentlich erreichbares Wiki mit gültigem Zertifikat.
- Ein Token oder eine Verbindung hat genau die Rechte seines Benutzers; jede Änderung steht im Audit-Log. Einrichtung und Werkzeuge: [docs/mcp.md](docs/mcp.md).

## Installation und Betrieb

- **Installer `install.sh`** für Ubuntu: fragt Domain, Betriebsart, SMTP-Zugang, ersten Administrator, Sicherungsziel, Überwachung, Office-Editor und draw.io ab, erzeugt `.env` mit zufälligen Schlüsseln, installiert bei Bedarf Docker, baut und startet das Wiki, prüft API, Zertifikat, draw.io und Mailversand (mit Testmail) und zeigt das Startpasswort des ersten Administrators an. Erneut aufgerufen ändert er die Konfiguration, ohne Schlüssel zu ersetzen; mit `--non-interactive` läuft er ohne Rückfragen.
- **Drei Betriebsarten** für VPS und eigenen Server: öffentlich mit Let's Encrypt, nur im eigenen Netz mit eigener Zertifizierungsstelle, oder hinter einem vorhandenen Reverse Proxy (nginx, Apache, Traefik), der HTTPS übernimmt. Echte Client-IPs bleiben dabei erhalten, auch über IPv6.
- **Mailversand in der Administration** (**Administration → E-Mail**): SMTP-Server, Verschlüsselung, Zugang und Absender ändern, Verbindung vor dem Speichern prüfen, Testmail senden. Hat Vorrang vor `.env`; das Passwort liegt verschlüsselt in der Datenbank.
- **`wikictl`** für den Betrieb (Übersicht mit `sudo wikictl help`):

  | Befehl | Zweck |
  | --- | --- |
  | `status`, `logs [dienst]` | Zustand und Logs |
  | `update [git-ref]` | Update mit vorheriger Sicherung und Platzprüfung, fragt neue optionale Dienste einmal ab, räumt danach alte Images und Build-Cache auf |
  | `cleanup` | Platz schaffen (Build-Cache, unbenutzte Images, Journal); Volumes und Sicherungen bleiben |
  | `backup`, `snapshots`, `restore <id\|latest>`, `restore-test` | Sicherung, Stände, Wiederherstellung (auch auf einem neuen Server), Test-Wiederherstellung |
  | `office on\|off`, `office-check`, `drawio on\|off` | Optionale Dienste |
  | `create-admin`, `reset-password`, `mail-test` | Konten und Mailversand |
  | `reconfigure`, `monitor`, `ca-cert` | Installer erneut, Health-Check mit Push, Stammzertifikat (Betriebsart `internal`) |

- **Sicherung mit restic** (Datenbank, Anhänge, Zertifikate, `.env`; verschlüsselt, 7/4/6 Stände) an ein lokales Verzeichnis, per SFTP, auf S3 oder einen REST-Server, nächtlich per systemd-Timer; monatlich automatische **Test-Wiederherstellung** in einen Wegwerf-Container mit Prüfsummenkontrolle aller Anhänge.
- **Überwachung:** Healthchecks für API und Weboberfläche, Push an Uptime Kuma oder healthchecks.io alle 5 Minuten und nach jeder Sicherung; knapper Speicherplatz wird früh gemeldet.
- **Härtung:** optional ufw, automatische Sicherheitsupdates und fail2ban.

Für 10 bis 20 Benutzer reicht ein Server oder VPS mit 2 vCPU, 4 GB RAM und 40 GB SSD (Richtwert, nicht gemessen); mit Office-Editor 8 GB RAM.

`ENCRYPTION_KEY` in `.env` verschlüsselt die 2FA-Geheimnisse und das SMTP-Passwort aus der Administration. Er wird nie automatisch ersetzt und ist Teil der Sicherung; zusätzlich gehört das Passwort der Sicherung (`BACKUP_PASSWORD`) an einen Ort außerhalb des Servers.

## Aufbau

```
apps/
  api/        NestJS-API (TypeScript), Prisma, PostgreSQL, Redis
  web/        Next.js-Weboberfläche (React)
packages/
  shared/     Gemeinsame Typen und Passwortregeln
e2e/          Ende-zu-Ende-Tests mit Playwright
deploy/       caddy/ (Betriebsarten), drawio/, wikictl, systemd-Timer, fail2ban
docs/         Installation, Betrieb, MCP, Go-live-Checkliste
install.sh    Installer für Ubuntu
docker-compose.yml       Betrieb (Caddy, Web, API, PostgreSQL, Redis; optional Office, draw.io)
docker-compose.dev.yml   Entwicklung (PostgreSQL, Redis, Mailpit)
```

Jede Anfrage läuft über Caddy: `/api/*` geht an die API, `/office/` an den Office-Editor, `/draw/` an draw.io, alles andere an die Weboberfläche. PostgreSQL, Redis, Office-Editor und draw.io hängen in internen Docker-Netzen ohne Zugang nach außen; nur Caddy ist mit den Ports 80 und 443 erreichbar.

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

## Lokale Entwicklung

Voraussetzungen: Node.js 22, pnpm 10 (`corepack enable`), Docker.

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL, Redis, Mailpit
pnpm install
cp .env.example .env
```

In `.env` den Block „Nur lokale Entwicklung“ einkommentieren und `ENCRYPTION_KEY` sowie `SESSION_SECRET` setzen (`openssl rand -hex 32`). Für Mailpit `SMTP_URL=smtp://localhost:1025?tls=off` verwenden (`smtp://` verlangt sonst STARTTLS). Dann:

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

Die CI (`.github/workflows/ci.yml`) führt bei jedem Push Linter, Typprüfung, alle Tests, `pnpm audit`, einen Secret-Scan (Gitleaks) und einen Container-Scan (Trivy) aus. Dazu kommt eine Probeinstallation mit `install.sh --non-interactive` in den Betriebsarten `internal` und `proxy` mit Sicherung, Test-Wiederherstellung und Wiederherstellung sowie ein OWASP-ZAP-Baseline-Scan (Bericht als Artefakt `zap-report`). Die Shell-Skripte prüft `shellcheck -x install.sh deploy/wikictl deploy/lib.sh`.

## Sicherheitskonzept

Die Anforderungen S1 bis S14 aus dem Architekturkonzept sind Abnahmekriterien; welche Tests sie jeweils nachweisen, steht in [docs/go-live.md](docs/go-live.md#5-sicherheitsanforderungen-s1-bis-s14). Kurz gefasst:

- Passwörter mit Argon2id, Pflicht-2FA (TOTP) mit verschlüsseltem Geheimnis, gestaffelte Sperren nach Fehlversuchen und Rate-Limits für Anmeldung, API, Uploads und MCP.
- Sitzungen serverseitig in Redis, Cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax), CSRF-Schutz per Double-Submit-Token und Origin-Prüfung.
- Seiteninhalte als TipTap-JSON mit Whitelist in API und Weboberfläche, kein `dangerouslySetInnerHTML`, Content-Security-Policy mit Nonce je Anfrage.
- Uploads mit Typerkennung am Inhalt, Ablage außerhalb des Web-Roots, Auslieferung nur mit Rechteprüfung.
- Zentrale Rechteprüfung (`PermissionService`, „verweigern“ als Standard), die Baum, Suche, Anhänge und MCP gemeinsam nutzen.
- Nur anhängbares Audit-Log (365 Tage) für Anmeldungen, Rechteänderungen, Admin-Aktionen, Löschungen, Tokens und jede Änderung über MCP.
- Secret-Scan, `pnpm audit`, Container-Scan und OWASP-ZAP in der CI, Abhängigkeiten über Renovate.

Bilder lassen sich auch per https-Adresse einbinden; dabei sieht der fremde Server die IP-Adresse der Lesenden. Hochgeladene Bilder vermeiden das. Vor dem Zurücksetzen der 2FA einer Person deren Identität prüfen (z. B. telefonisch).

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
| `GET /attachments/:id/versions[/:version][?inline=1]` | Fassungen eines Anhangs auflisten, ältere herunterladen (mit `inline=1` Bilder anzeigen, z. B. Zeichnungen) | Leser |
| `POST /attachments/:id/versions` | Neue Fassung hochladen (Datei als Body, z. B. gespeicherte Zeichnung) | Bearbeiter |
| `GET /features` | Eingeschaltete optionale Dienste (Office-Editor, draw.io) | angemeldet |
| `GET /attachments/:id/office?mode=view\|edit` | Signierte Konfiguration für den Office-Editor | Leser / Bearbeiter |
| `POST /pages/:id/office-files` | Leere Word-, Excel- oder PowerPoint-Datei als Anhang anlegen (`kind`: docx, xlsx, pptx; `name`) | Bearbeiter |
| `GET /office/files/:token`, `POST /office/callback` | Datei für den Editor-Server, Rückruf nach dem Speichern (von außen gesperrt) | signierter Link / JWT |
| `GET /search?q=&space=&offset=` | Volltextsuche, nach Rechten gefiltert | angemeldet |
| `GET /directory` | Aktive Benutzer und Gruppen für die Rechtevergabe (ohne E-Mail) | angemeldet |
| `GET/PUT/DELETE /admin/settings/mail` | SMTP-Zugang ansehen, prüfen und speichern, auf `.env` zurücksetzen | Systemadmin |
| `POST /admin/settings/mail/test` | Testmail senden (Standard: an die eigene Adresse) | Systemadmin |
| `GET/POST /me/tokens`, `DELETE /me/tokens/:id` | Eigene API-Tokens für den MCP-Server (Anlegen mit 2FA-Code) | angemeldet |
| `GET/PUT /admin/api-access`, `DELETE /admin/api-access/tokens/:id` | MCP-Server ein- und ausschalten, alle Tokens sehen und widerrufen | Systemadmin |
| `POST /mcp` | MCP-Server (JSON-RPC, Streamable HTTP), siehe [docs/mcp.md](docs/mcp.md) | API-Token (`Authorization: Bearer`) |
| `GET /.well-known/oauth-protected-resource[/api/v1/mcp]`, `GET /.well-known/oauth-authorization-server` | OAuth-Metadaten für claude.ai (Caddy leitet `/.well-known/oauth-*` hierher) | öffentlich |
| `POST /oauth/register`, `POST /oauth/token`, `POST /oauth/revoke` | OAuth: Client-Registrierung, Tokens mit PKCE und Erneuerung, Widerruf | öffentlich (Client-Anmeldung) |
| `GET /oauth/authorize/check`, `POST /oauth/authorize` | Zustimmungsseite `/oauth/authorize` (mit 2FA-Code) | angemeldet |
| `GET /health` | Datenbank, Redis, Speicherplatz | öffentlich |

## Nächste Meilensteine

| Meilenstein | Inhalt |
| --- | --- |
| M4 Go-live | Umgesetzt bis auf den Pilotbetrieb selbst (Checkliste in [docs/go-live.md](docs/go-live.md)) |
| M5 Zusammenarbeit | Kommentare, Benachrichtigungen, Vorlagen, Labels; Hintergrund-Worker (BullMQ) für Mails und ggf. Volltext aus PDF-Anhängen |
| M6 Ausbau | Gleichzeitiges Bearbeiten von Wiki-Seiten, Export, Webhooks |
