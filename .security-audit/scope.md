# Security audit scope: wikifordummys

- **Audited by:** Claude Code (Opus 5.5) · **Date:** 2026-10-27 · **Commit:** 1e85dbc (main), dazu Zweig `claude/project-thread-ueu291` @ 55da6b1 (OAuth, PR #19, nicht gemergt)
- **Purpose and users:** Selbst gehostetes, Confluence-artiges Wiki mit Benutzerverwaltung (Spaces, Seitenbaum, Versionen, Anhänge, Suche, Office-Editor, draw.io, MCP-Zugang für Claude). 10–20 Benutzer.
- **Stack:** TypeScript; Next.js 15 (Web), NestJS 11 (API), Prisma 6 / PostgreSQL 16, Redis 7, Caddy 2; Docker Compose; Bash-Installer und `wikictl`; Euro-Office (ONLYOFFICE-Fork), draw.io statisch.
- **Exposure:** Internet-facing über Caddy (Betriebsart letsencrypt), alternativ internal oder hinter vorhandenem Proxy.
- **Data handled:** Personenbezogene Daten (Namen, E-Mail-Adressen, Audit-Log mit IPs), Zugangsdaten (Argon2id-Hashes, TOTP-Geheimnisse verschlüsselt, SMTP-Passwort verschlüsselt), beliebige Wiki-Inhalte und Anhänge.
- **Countries and sectors:** Deutschland, privat/kleines Team (angenommen).
- **Authorisation confirmed by:** Fabian (Repository-Eigentümer, Auftrag im Projekt-Thread), 2026-10-27
- **In scope:** apps/api, apps/web, packages/shared, deploy/, install.sh, docker-compose*.yml, .github/workflows, OAuth-Commit 55da6b1. · **Out of scope:** Upstream-Images (Euro-Office, draw.io), der laufende Server unter /opt/wikifordummys, node_modules.
- **Repository:** private. Register committed: yes (ohne raw/).
- **Connectors and consent:** GitHub (nur Lesen von PR-Metadaten; keine Tickets angelegt, kein Code gesendet). Keine weiteren Dienste.
- **Gate:** Standard (keine offenen Critical/High; jedes Medium behoben oder als Risiko akzeptiert). Approver: Fabian.
- **Coverage:** Full (Secrets: Gitleaks; Code: Semgrep mit Regeln aus github.com/semgrep/semgrep-rules, da semgrep.dev gesperrt; Abhängigkeiten: OSV-Scanner offline; IaC: Checkov; CI: zizmor offline).

Annahmen, weil die Scoping-Fragen nicht gestellt wurden (Fabian war nicht im Thread): Exposure, Daten und Gate stammen aus den Projektnotizen. Bitte korrigieren, falls etwas nicht stimmt.

## Attack surface map

- **Entry points:** REST-API unter `/api/v1` (auth, me, spaces, pages, attachments, search, directory, admin, settings, tokens, office, mcp, health, features); Next.js-Seiten; `/office/*` (Editor-Server), `/draw/*` (statisch); im OAuth-Zweig `/.well-known/oauth-*`, `/api/v1/oauth/{register,token,revoke,authorize}`; täglicher Papierkorb-Job in der API; CLI `cli.ts` über `wikictl`.
- **Authentication:** Session-Cookie `__Host-session` (Redis, nur Hash gespeichert), Stufen password → 2FA (TOTP/Recovery) → full; CSRF Double Submit + Origin-Prüfung; MCP nur per Bearer-Token `wfd_…`; Office-Rückruf per JWT; OAuth 2.1 mit PKCE im Zweig.
- **Authorisation:** Globaler `AuthGuard` (Standard verweigern, @Public/@AdminOnly), `PermissionService` für Space-Rollen und vererbte Seiteneinschränkungen, 404 statt 403 bei fehlender Sicht.
- **Data stores and external calls:** PostgreSQL (Prisma, Raw-SQL nur parametrisiert), Redis (Sitzungen, Rate-Limits, OAuth-Codes), Dateisystem-Volume für Anhänge; ausgehend SMTP, Editor-Server (intern), Monitoring-Ping, restic-Ziel.
- **AI features:** MCP-Server (`apps/api/src/mcp`) mit Lese- und Schreibwerkzeugen für Seiten und Zeichnungen, serverseitiges Rendern von draw.io-XML mit resvg.
- **Infrastructure and CI:** docker-compose.yml (Netze backend/office/drawio intern), Caddy-Konfiguration je Betriebsart, systemd-Timer, fail2ban, GitHub Actions CI mit ZAP-Baseline.
- **Size:** ~16.700 Zeilen ohne Tests (215 Dateien im Repo).

## Hotspots

1. Anmeldung, 2FA, Passwort-Reset, Einladungen (`apps/api/src/auth`)
2. Rechteprüfung Spaces/Seiten/Einschränkungen und Suche (`spaces/permission.service.ts`, `pages`, `search`)
3. Anhänge hochladen/ausliefern (`attachments`), Office-Rückruf (`office`)
4. Inhalts-Whitelist und Darstellung (`packages/shared/src/content.ts`, `RichText.tsx`, CSP)
5. MCP-Server, Tokens, draw.io-Verarbeitung, OAuth-Zweig
6. Installer, `wikictl`, Caddy, Compose, fail2ban
