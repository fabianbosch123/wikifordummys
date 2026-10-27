# Security findings: wikifordummys

Last run R1 · commit 1e85dbc · 2026-10-27 · Gate: FAILED · Coverage: Full

|            | Critical | High | Medium | Low | Info |
|------------|----------|------|--------|-----|------|
| Open       | 0 | 0 | 6 | 8 | 6 |

Gate scheitert nur an den Medium-Findings: Sie müssen behoben oder als Risiko akzeptiert werden.

## Open

### SEC-001 · Medium · Entpack-Bombe beim Lesen von draw.io-Daten legt die API lahm
- **Where:** apps/api/src/mcp/drawio.ts:54 (decompressDiagram); apps/api/src/mcp/drawio.ts:558 (extractXml)
- **Category:** A06:2025 · CWE-409 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** inflateRawSync (komprimiertes <diagram> aus create_drawing/update_drawing, bis 1 MB XML) und inflateSync (zTXt-Block 'mxGraphModel' in einem gespeicherten PNG, bis 20 MB über read_drawing bzw. resolveContent) laufen ohne maxOutputLength. Deflate packt Nullbytes etwa 1:1000 (geprüft: 200 MiB -> 204 KB). Ein hochgeladenes PNG mit 20 MB zTXt würde auf viele GB entpackt; die Begrenzung MAX_DRAWING_XML greift erst vor dem Entpacken.
- **Impact:** Jeder Benutzer mit Bearbeiten-Recht kann ein präpariertes PNG als Anhang hochladen; sobald irgendein MCP-Client es liest, läuft der API-Prozess in den Speicher-Engpass. Ohne Speichergrenze im Container (B4 offen) kann das den ganzen Server einschließlich Datenbank treffen.
- **How to fix:** inflateRawSync/inflateSync mit { maxOutputLength: MAX_DRAWING_XML } (z. B. 2 MB) aufrufen und den Fehler als DrawingError melden; zusätzlich mem_limit für den api-Container setzen (siehe B4 im Code-Review).
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-002 · Medium · Fremde können jedes Konto per Fehlversuchen bis zu einer Stunde aussperren
- **Where:** apps/api/src/auth/auth.service.ts:50 (AuthService.login); apps/api/src/infra/rate-limit.service.ts:54 (RateLimitService.registerFailure)
- **Category:** A07:2025 · CWE-645 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** Die steigende Sperre login:<Konto> gilt unabhängig von der IP: ab 5 Fehlversuchen 1 min, dann verdoppelt bis 1 h, Zähler 24 h. Wer eine E-Mail-Adresse kennt, hält das Konto mit wenigen Anfragen pro Stunde dauerhaft gesperrt; Rotation über viele IPs umgeht fail2ban und das IP-Limit.
- **Impact:** Gezielter Ausfall einzelner Personen, etwa des einzigen Administrators. Das Wiki ist öffentlich erreichbar, die Anmeldung braucht kein Konto.
- **How to fix:** Konto-Sperre an (Konto, IP oder /64-Netz) koppeln und konto-weit nur ein mildes Limit lassen; alternativ nach Sperre eine Anmeldung über einen per Mail geschickten Link erlauben. Fehlversuche weiter im Audit-Log zählen.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-003 · Medium · Kein Speicherkontingent für Anhänge: Bearbeiter können die Platte füllen
- **Where:** apps/api/src/attachments/attachments.service.ts:87 (AttachmentsService.upload); apps/api/src/attachments/attachments.service.ts:114 (AttachmentsService.uploadVersion)
- **Category:** A06:2025 · CWE-400 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** Je Datei gilt ATTACHMENT_MAX_MB (50 MiB), aber weder je Benutzer noch insgesamt eine Grenze; neue Fassungen werden unbegrenzt aufgehoben. Uploads laufen nur unter dem allgemeinen Limit von 300 Anfragen/Minute.
- **Impact:** Ein einzelnes Konto (oder ein gestohlenes) füllt in Minuten die Platte. Am 2026-10-23 hat eine volle Platte die Datenbank bereits gestoppt; das wäre gezielt wiederholbar.
- **How to fix:** Freien Platz vor dem Speichern prüfen (z. B. Upload ablehnen unter 2 GB frei), Kontingent je Benutzer und Tag (Summe sizeBytes) und ein eigenes Upload-Rate-Limit einführen; wikictl monitor warnt bereits unter 1 GB.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-004 · Medium · Test-Werkzeug vitest 3.2 mit bekannten Lücken (tinypool, @vitest/mocker)
- **Where:** apps/api/package.json:57 (vitest); pnpm-lock.yaml (tinypool); pnpm-lock.yaml (@vitest/mocker)
- **Category:** A03:2025 · CWE-1395 · Confidence: Confirmed
- **Found by:** osv-scanner:GHSA-5gmw-xhrv-c9v3, osv-scanner:GHSA-85c8-ppgw-ccpr, osv-scanner:GHSA-82fw-gwwq-j7x9, osv-scanner:GHSA-qxg6-89mg-rqv8
- **What's wrong:** tinypool 1.1.1 (über vitest 3.2.7): zwei Prototype-Pollution-zu-RCE-Gadgets, Advisory Critical, behoben in 2.1.2. @vitest/mocker 3.2.7: Path Traversal und Code-Injection über Mock-Registrierung, behoben in 4.1.12. Bewertung: Critical, eine Stufe herab (nur Entwicklung/CI), eine Stufe herab (Gadget braucht eine zweite Lücke im Testprozess).
- **Impact:** Betrifft nur Entwickler-Rechner und CI, nicht den Server. Ein bösartiger Pull Request könnte in CI mehr erreichen als nötig.
- **How to fix:** vitest auf 4.1.12 oder neuer heben (Major-Sprung, Tests prüfen); Renovate-PR dafür zulassen.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-005 · Medium · Offene Weiterleitung nach der Anmeldung über next=/%09/…
- **Where:** apps/web/src/lib/nav.ts:3 (safeNext)
- **Category:** A01:2025 · CWE-601 · Confidence: Likely
- **Found by:** AI review
- **What's wrong:** safeNext lässt '/\t/evil.example' durch (beginnt mit '/', nicht mit '//'). Browser und URL-Parser entfernen Tab und Zeilenumbruch, new URL('/\t/evil.example', origin) ergibt https://evil.example/ (geprüft). router.replace führt dann eine externe Navigation aus.
- **Impact:** Ein Link https://wiki/login?next=%2F%09%2Fevil.example führt nach echter Anmeldung mit 2FA auf eine fremde Seite, die z. B. eine gefälschte 'Sitzung abgelaufen'-Maske zeigt (Phishing mit dem Vertrauen in die eigene Domain).
- **How to fix:** In safeNext Steuerzeichen und Backslashes ablehnen und das Ziel mit new URL(next, location.origin) auflösen; nur zulassen, wenn origin gleich bleibt, und dann pathname+search+hash verwenden.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-006 · Medium · Indirekte Prompt-Injection über Wiki-Inhalte an Claude (MCP) mit Schreibrecht
- **Where:** apps/api/src/mcp/mcp.service.ts:26 (SERVER_INSTRUCTIONS); packages/shared/src/content.ts:86 (isSafeImageSrc)
- **Category:** A06:2025 · CWE-1427 · LLM01:2025 Prompt Injection; LLM06:2025 Excessive Agency · Confidence: Likely
- **Found by:** AI review
- **What's wrong:** read_page/search/read_drawing geben Seiteninhalte anderer Benutzer an das Modell. Die Server-Anweisungen sagen nicht, dass Inhalte Daten und keine Anweisungen sind. Mit einem write-Token kann das Modell Seiten anlegen und ändern; Bilder mit beliebigen https-Adressen sind erlaubt und werden beim Ansehen geladen (CSP img-src https:).
- **Impact:** Ein Benutzer schreibt versteckte Anweisungen in eine Seite. Liest die Claude-Sitzung eines Kollegen mit mehr Rechten sie, kann sie Inhalte eingeschränkter Seiten in eine Seite oder eine Bild-URL zu einem fremden Server schreiben (Abfluss) oder Seiten verfälschen. Änderungen sind versioniert und im Audit-Log, der Abfluss nicht.
- **How to fix:** In SERVER_INSTRUCTIONS und in jeder Tool-Antwort Inhalte klar als nicht vertrauenswürdige Daten markieren; für MCP-geschriebene Inhalte externe Bild-URLs ablehnen oder nur eine Allowlist erlauben; in der Doku read-Tokens als Standard empfehlen; optional eine Bestätigung im Client für Schreibwerkzeuge (destructiveHint).
- **Owner:** – · **Ticket:** – · **First seen:** R1
- **Compliance:** DSGVO (personenbezogene Daten im Wiki)

### SEC-007 · Low · API-Tokens und OAuth-Zugänge überleben Passwortwechsel und 'andere Sitzungen beenden'
- **Where:** apps/api/src/auth/auth.service.ts:351 (AuthService.changePassword); apps/api/src/me/me.controller.ts:93 (revokeOthers)
- **Category:** A07:2025 · CWE-613 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** Passwort-Reset, 2FA-Reset und Admin-Sitzungsende widerrufen API-Tokens, der eigene Passwortwechsel und 'alle anderen Sitzungen beenden' im Profil nicht.
- **Impact:** Wer ein Konto zurückerobert und dazu sein Passwort ändert, lässt ein vom Angreifer angelegtes Token (bis 365 Tage) aktiv.
- **How to fix:** Beim Passwortwechsel und bei 'andere Sitzungen beenden' revokeApiTokens aufrufen (oder in der Oberfläche fragen) und die Anzahl im Audit-Log festhalten.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-008 · Low · 2FA-Bestätigung heikler Aktionen ohne steigende Sperre
- **Where:** apps/api/src/auth/auth.service.ts:186 (AuthService.confirmTotp)
- **Category:** A07:2025 · CWE-307 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** confirmTotp (API-Token anlegen, Wiederherstellungscodes, OAuth-Zustimmung im Zweig) hat nur 5 Versuche/Minute, keine Sperre wie beim Login. Mit window=1 gelten 3 Codes; 7200 Versuche/Tag ergeben rund 2 % Erfolg pro Tag.
- **Impact:** Wer eine fremde, vollständige Sitzung erbeutet hat, kann sich über Tage ein dauerhaftes Token oder neue Wiederherstellungscodes erraten.
- **How to fix:** Dieselbe steigende Sperre wie in verifySecondFactor nutzen (registerFailure/assertNotLocked mit Scope 2fa-confirm:<user>) und nach mehreren Fehlschlägen die Sitzung beenden.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-009 · Low · zod 3.25.76 (Advisory zu Speicherverbrauch)
- **Where:** apps/api/package.json:41 (zod)
- **Category:** A03:2025 · CWE-400 · Confidence: Confirmed
- **Found by:** osv-scanner:GHSA-mrhx-c7xc-m3w5
- **What's wrong:** Advisory High, behoben erst in zod 4.6.6. Betroffen sind große, begrenzte Collections (array/set mit max). Die eigenen Schemas (config.ts, mcp.service.ts) nutzen keine; JSON-Body ist auf 1 MB begrenzt. Zwei Stufen herab.
- **Impact:** Kaum ausnutzbar in diesem Projekt; das MCP-SDK bringt eigene zod-Schemas mit.
- **How to fix:** Bei der nächsten SDK-Aktualisierung auf zod 4 wechseln (das MCP-SDK unterstützt beide).
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-010 · Low · multer 2.4.0 über @nestjs/platform-express (DoS-Advisory, nicht genutzt)
- **Where:** apps/api/package.json:22 (@nestjs/platform-express); pnpm-lock.yaml (multer)
- **Category:** A03:2025 · CWE-400 · Confidence: Confirmed
- **Found by:** osv-scanner:GHSA-q7qp-rjg7-q26m
- **What's wrong:** multer < 2.5.0: DoS über hängenden fileFilter. Uploads laufen ohne multer (octet-stream-Body), kein FileInterceptor im Code. Zwei Stufen herab.
- **Impact:** Nicht erreichbar, solange niemand FileInterceptor einführt.
- **How to fix:** @nestjs/platform-express aktualisieren, sobald es multer >= 2.5.0 zieht, oder pnpm-Override multer@^2.5.0.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-011 · Low · GitHub Actions nicht auf Commit-SHA festgelegt, checkout behält Token
- **Where:** .github/workflows/ci.yml:30 (uses); .github/workflows/ci.yml:30 (persist-credentials)
- **Category:** A03:2025 · CWE-829 · Confidence: Confirmed
- **Found by:** zizmor:unpinned-uses, zizmor:artipacked, semgrep:third-party-action-not-pinned-to-commit-sha
- **What's wrong:** 11 uses: mit Tags (@v4) statt SHA; actions/checkout ohne persist-credentials: false (5 Stellen). Workflow-Rechte sind bereits auf contents: read begrenzt.
- **Impact:** Ein kompromittiertes Action-Tag (wie 2025 bei tj-actions) liefe in CI; das Token hat nur Leserechte.
- **How to fix:** Actions auf volle SHAs pinnen (Renovate pflegt sie mit helpers:pinGitHubActionDigests) und persist-credentials: false setzen.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-012 · Low · Container-Härtung und schwebende Image-Tags
- **Where:** docker-compose.yml:11 (services.caddy.image); docker-compose.yml:158 (services.redis.command); apps/api/Dockerfile:3 (FROM)
- **Category:** A02:2025 · CWE-1188 · Confidence: Confirmed
- **Found by:** checkov:CKV_DOCKER_7, semgrep:dockerfile-source-not-pinned, AI review
- **What's wrong:** caddy:2, postgres:16, redis:7, node:22-bookworm-slim ohne Digest; office nur mit Tag. api, web, caddy, db, redis ohne cap_drop/no-new-privileges/read_only (drawio hat es). Redis-Passwort steht in der Kommandozeile (docker inspect, ps). Keine Speichergrenzen (siehe B4).
- **Impact:** Mehr Wirkung nach einem Einbruch in einen Container; ein manipuliertes oder fehlerhaftes Upstream-Image kommt beim nächsten 'wikictl update' ungeprüft herein.
- **How to fix:** security_opt no-new-privileges und cap_drop: [ALL] (mit nötigen cap_add) für api/web/caddy; read_only mit tmpfs für web/api; Images per Digest pinnen und von Renovate pflegen lassen; Redis-Passwort über eine Konfigurationsdatei statt Argument.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-013 · Low · IPv6-Zugriffe erscheinen evtl. alle als Docker-Gateway: Limits treffen alle
- **Where:** deploy/fail2ban/jail.d/wikifordummys.local:12 (ignoreip); apps/api/src/common/request-context.ts:29 (clientIp)
- **Category:** A07:2025 · CWE-348 · Confidence: Needs check
- **Found by:** AI review
- **What's wrong:** Laut Kommentar in der fail2ban-Konfiguration sieht die API über Dockers userland-proxy bei IPv6 die Gateway-Adresse. Dann teilen sich alle IPv6-Nutzer die Limits login:ip, 2fa:ip, reset:ip, invite:ip und mcp:ip; das Audit-Log zeigt keine echten IPs.
- **Impact:** Ein Angreifer über IPv6 löst 429 für alle IPv6-Nutzer aus; fail2ban kann diese Angreifer nicht sperren.
- **How to fix:** Auf dem Server prüfen (Audit-Log: IPs 172.x bei Anmeldungen?). Abhilfe: IPv6 in Docker aktivieren (ip6tables, userland-proxy aus) oder Caddy im Host-Netz betreiben.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-014 · Low · fail2ban liest die Logs aller Container
- **Where:** deploy/fail2ban/jail.d/wikifordummys.local:8 (logpath)
- **Category:** A09:2025 · CWE-117 · Confidence: Needs check
- **Found by:** AI review
- **What's wrong:** logpath = /var/lib/docker/containers/*/*-json.log. Caddy schreibt JSON, dadurch scheitert Einschleusen über User-Agent (geprüft). Gibt aber irgendein Container (office, db, web) Angreifer-Text ungeschützt als Klartext aus, passt das Muster und sperrt eine frei gewählte öffentliche IP.
- **Impact:** Möglicher Weg, fremde IPs (z. B. die eines Benutzers) für eine Stunde auszusperren.
- **How to fix:** logpath auf den api-Container beschränken (Docker-Logging mit tag und journald-Backend, Filter auf CONTAINER_NAME) oder die API in eine eigene Datei loggen lassen.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-015 · Info · AES-GCM entschlüsselt ohne feste Tag-Länge
- **Where:** apps/api/src/infra/crypto.service.ts:32 (CryptoService.decrypt)
- **Category:** A04:2025 · CWE-310 · Confidence: Confirmed
- **Found by:** semgrep:gcm-no-tag-length, AI review
- **What's wrong:** createDecipheriv('aes-256-gcm') ohne authTagLength akzeptiert gekürzte Tags (in Node 23+ als veraltet gemeldet).
- **Impact:** Nur ausnutzbar mit Schreibzugriff auf die Datenbank.
- **How to fix:** createDecipheriv(..., { authTagLength: 16 }) und Tag-Länge prüfen.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-016 · Info · Externe Bilder auf Seiten: Leser-IPs gehen an fremde Server
- **Where:** apps/web/src/middleware.ts:16 (middleware)
- **Category:** A02:2025 · CWE-359 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** CSP img-src erlaubt https: und der Inhalt erlaubt https-Bildquellen. Absicht (Bilder von außen einbinden), aber auch Kanal für Tracking und für SEC-006.
- **Impact:** Fremde sehen, wer wann eine Seite liest.
- **How to fix:** Entscheiden, ob externe Bilder nötig sind; sonst img-src 'self' data: blob: und isSafeImageSrc auf Wiki-Pfade beschränken.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-017 · Info · Wiederhergestellte Seitenversionen werden nicht neu geprüft
- **Where:** apps/api/src/pages/pages.service.ts:407 (PagesService.restoreVersion)
- **Category:** A08:2025 · CWE-20 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** restoreVersion übernimmt den alten Inhalt ohne sanitizeDoc. Wird die Inhalts-Whitelist später verschärft, kommen alte Inhalte daran vorbei. Die Anzeige prüft URLs zusätzlich, daher derzeit ohne Wirkung.
- **Impact:** Kein aktuelles Risiko.
- **How to fix:** parseContent(old.content) auch beim Wiederherstellen aufrufen.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-018 · Info · Office-Editor darf private Adressen abrufen
- **Where:** docker-compose.yml:94 (services.office.environment.ALLOW_PRIVATE_IP_ADDRESS)
- **Category:** A01:2025 · CWE-918 · Confidence: Confirmed
- **Found by:** AI review
- **What's wrong:** Nötig, damit der Editor-Server Dateien bei api:3001 holt. Bearbeiter können ihn über 'Bild aus URL' an private Adressen schicken; im internen Netz office sind nur caddy und api, deren interne Pfade per JWT geschützt sind.
- **Impact:** Derzeit nur öffentliche API-Pfade erreichbar.
- **How to fix:** So lassen, aber beim Hinzufügen weiterer Dienste ins Netz office daran denken.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-019 · Info · postMessage an draw.io mit Ziel '*'
- **Where:** apps/web/src/components/editor/DrawioDialog.tsx:65 (DrawioDialog)
- **Category:** A02:2025 · CWE-345 · Confidence: Confirmed
- **Found by:** semgrep:wildcard-postmessage-configuration, AI review
- **What's wrong:** Wegen sandbox ohne allow-same-origin hat der Rahmen den Ursprung 'null', '*' ist daher nötig; eingehende Nachrichten werden korrekt über e.source geprüft.
- **Impact:** Nur relevant, wenn der Rahmen auf eine fremde Seite navigiert würde; CSP von Caddy verhindert fremde Verbindungen.
- **How to fix:** Vor jedem post prüfen, dass der Rahmen noch geladen ist (z. B. nach 'init'), sonst nichts senden.
- **Owner:** – · **Ticket:** – · **First seen:** R1

### SEC-020 · Info · OAuth-Zweig (PR #19, nicht gemergt): offene Client-Registrierung und Zustimmungs-Phishing prüfen
- **Where:** apps/api/src/oauth/oauth.service.ts:161 (OAuthService.register)
- **Category:** A07:2025 · CWE-1021 · Confidence: Needs check
- **Found by:** AI review
- **What's wrong:** Geprüft auf Commit 55da6b1 (Zweig claude/project-thread-ueu291). PKCE S256 Pflicht, Code einmalig, Refresh-Rotation mit Wiederverwendungserkennung, Zustimmung mit CSRF und 2FA: solide. Offen: Jeder kann ohne Anmeldung Clients mit frei gewähltem Namen und Rücksprung zu claude.ai registrieren; ob ein von einem fremden claude.ai-Konto begonnener Ablauf nach Zustimmung beim Opfer im Konto des Angreifers landet, hängt von claude.ai ab.
- **Impact:** Möglicher Weg, einem Benutzer per Link eine Zustimmung für das claude.ai-Konto eines Fremden unterzuschieben.
- **How to fix:** Vor dem Mergen: Zustimmungsseite deutlich warnen ('nur zustimmen, wenn du das gerade selbst in Claude gestartet hast' steht schon drin), Client-Registrierung optional auf angemeldete Admins beschränken oder Clients nach Name/Host im Admin-Bereich sichtbar machen; Ablauf einmal mit zwei claude.ai-Konten testen.
- **Owner:** – · **Ticket:** – · **First seen:** R1

## Fixed, awaiting verification

Keine.

## Accepted risks (with expiry dates)

Keine.

## False positives

Keine.

## Verified (closed)

Keine.

## Triage dismissals (for human review)

- **gitleaks:generic-api-key** · apps/api/test/auth.spec.ts:410,416 · Test-Passwörter in Testdaten (auch im Verlauf); .gitleaks.toml erlaubt apps/api/test/ bewusst.
- **semgrep:html-in-template-string (16x)** · apps/api/src/mcp/drawio.ts · SVG wird für resvg gebaut, nicht als HTML ausgeliefert; Texte laufen durch esc(), Farben durch color(), Zahlen durch num().
- **semgrep:jsx-not-internationalized (190x), missing-template-string-indicator (13x), react-props-spreading (4x), react-props-in-state** · apps/web/src · Stil- und i18n-Regeln ohne Sicherheitsbezug.
- **semgrep:unsafe-dynamic-method** · packages/shared/src/content.ts:198 · NODES[type] erst nach Object.hasOwn(NODES, type); nur eigene Bereinigungsfunktionen erreichbar.
- **semgrep:unquoted-variable-expansion-in-command (4x)** · install.sh:74,187,197,201 · $check ist ein interner Funktionsname; die übrigen Zeilen sind Zuweisungen.
- **semgrep:detect-insecure-websocket** · .security-audit/raw/R1/osv.json · Treffer in Scanner-Ausgabe, nicht im Code.
- **semgrep:remove-package-cache, set-pipefail, missing-image-version (5x)** · apps/api/Dockerfile, deploy/drawio/Dockerfile, ci.yml services · apt-Listen werden gelöscht; drawio-Download prüft SHA-256; Image-Tags in SEC zu Container-Härtung zusammengefasst.
- **checkov:CKV_DOCKER_2 (3x), CKV_DOCKER_3** · apps/*/Dockerfile, deploy/drawio/Dockerfile · Healthchecks und user 65534 für drawio stehen in docker-compose.yml.
