# Go-live-Checkliste (Meilenstein 4)

Abnahmekriterium laut Architekturkonzept: **alle Punkte S1 bis S14 erfüllt; Pilot zwei Wochen ohne blockierende Fehler.** Diese Liste einmal vor dem Pilot und einmal vor der Freigabe für alle durchgehen.

## 1. Installation

- [ ] Server mit Ubuntu 22.04/24.04, `sudo ./install.sh` ohne Fehler durchgelaufen
- [ ] `sudo wikictl status`: alle Dienste `running`, API und Weboberfläche `healthy`, Zertifikat gültig
- [ ] Wiki im Browser unter `https://<domain>` ohne Zertifikatswarnung erreichbar (Betriebsart `internal`: Stammzertifikat auf den Pilot-Geräten importiert)
- [ ] Testmail aus **Administration → E-Mail** kommt an (auch Spam-Ordner prüfen)
- [ ] Erster Administrator hat sich angemeldet, 2FA eingerichtet, Wiederherstellungscodes sicher abgelegt
- [ ] „Passwort vergessen“ einmal ausprobiert

## 2. Sicherung und Wiederherstellung

- [ ] `sudo wikictl backup` erfolgreich, Ziel liegt nicht auf derselben Platte
- [ ] Sicherungspasswort (`BACKUP_PASSWORD`) außerhalb des Servers abgelegt
- [ ] `sudo wikictl restore-test` erfolgreich
- [ ] Timer aktiv: `systemctl list-timers 'wikifordummys-*'`
- [ ] Optional einmal geübt: Wiederherstellung auf einem zweiten Server ([betrieb.md](betrieb.md#wiederherstellung-auf-einem-neuen-server))

## 3. Überwachung

- [ ] Externer Monitor auf `https://<domain>/api/v1/health` (Uptime Kuma, UptimeRobot …) oder `MONITOR_PING_URL` gesetzt
- [ ] Benachrichtigung des Monitors einmal ausgelöst (z. B. `sudo wikictl stop`, nach dem Alarm `sudo wikictl start`)
- [ ] `BACKUP_PING_URL` gesetzt oder Sicherung anders überwacht

## 4. Server-Härtung

- [ ] Nur Ports 22, 80, 443 offen (`sudo ufw status`; bei VPS auch die Firewall des Anbieters)
- [ ] SSH nur mit Schlüssel, Root-Login aus
- [ ] Automatische Sicherheitsupdates aktiv (`/etc/apt/apt.conf.d/20auto-upgrades`)
- [ ] fail2ban aktiv (`sudo fail2ban-client status wikifordummys`), sofern direkt erreichbar
- [ ] Security-Header geprüft, z. B. mit [securityheaders.com](https://securityheaders.com) (Erwartung: A oder besser)

## 5. Sicherheitsanforderungen S1 bis S14

| Nr. | Anforderung | Nachweis | Stand |
| --- | --- | --- | --- |
| S1 | Passwort-Hashing (Argon2id) | `password.service.spec.ts`, `auth.spec.ts` | in CI grün |
| S2 | 2FA für alle | `auth.spec.ts`, E2E `onboarding.spec.ts` | in CI grün |
| S3 | Rate-Limiting | `auth.spec.ts` (429 mit `Retry-After`), zusätzlich fail2ban | in CI grün |
| S4 | Sitzungen | `auth.spec.ts` | in CI grün |
| S5 | CSRF | `auth.spec.ts` | in CI grün |
| S6 | XSS, CSP mit Nonce | `content.spec.ts`, `pages.spec.ts`, ZAP-Scan | in CI grün |
| S7 | Uploads | `attachments.spec.ts`, E2E `m3.spec.ts` | in CI grün |
| S8 | Autorisierung | `rights.spec.ts` (jede Route mit jeder Rolle), `settings.spec.ts` | in CI grün |
| S9 | Eingaben | `pages.spec.ts`, `rights.spec.ts`, `search.spec.ts`, `settings.spec.ts` | in CI grün |
| S10 | Keine Konto-Ausforschung | `auth.spec.ts` | in CI grün |
| S11 | Security-Header | Caddy + helmet; ZAP-Regeln 10020, 10021, 10035, 10038 als FAIL | in CI grün; securityheaders.com auf dem Server prüfen |
| S12 | Audit-Log | `auth.spec.ts`, `admin.spec.ts`, `rights.spec.ts`, `settings.spec.ts` | in CI grün |
| S13 | Geheimnisse nur in `.env` (600) | Gitleaks in CI; Installer setzt Rechte 600; SMTP-Passwort aus der Administration verschlüsselt | in CI grün |
| S14 | Abhängigkeiten | Renovate, `pnpm audit`, Trivy in CI | in CI grün |

**OWASP ZAP:** Die CI installiert das Wiki bei jedem Push mit dem Installer (Betriebsart `internal`) und führt einen ZAP-Baseline-Scan dagegen aus. Regeln für Header, Cookies, Informationslecks und gemischte Inhalte brechen den Build ab (`.zap/rules.tsv`); der Bericht liegt als Artefakt `zap-report` am CI-Lauf. Stand Meilenstein 4: keine FAIL-Befunde. Verbleibende Hinweise sind bewusst: die CSP erlaubt `img-src https:` für eingebundene externe Bilder und `style-src 'unsafe-inline'` für den Editor.

Ein Baseline-Scan prüft passiv und ohne Anmeldung. Für einen angemeldeten, aktiven Scan gegen eine Testinstanz (nie gegen die Produktivinstanz):

```bash
docker run --rm --network host -v "$PWD/.zap:/zap/wrk:rw" zaproxy/zap-stable:2.16.1 \
  zap-full-scan.py -t https://wiki-test.firma.de -c rules.tsv -r full-report.html
```

## 6. Pilot (zwei Wochen, 3 bis 5 Personen)

Vorbereitung:

- [ ] Pilotgruppe festgelegt (verschiedene Rollen, mindestens eine Person ohne IT-Hintergrund)
- [ ] Gruppe `pilot` angelegt, ein bis zwei Spaces mit echten Inhalten vorbereitet
- [ ] Einladungen verschickt; Ansprechpartner und Kanal für Rückmeldungen genannt
- [ ] Erwartung klar: „Alles, was nicht geht oder umständlich ist, sofort melden“

Während des Pilots täglich kurz:

- [ ] `sudo wikictl status` und Monitor ohne Alarm
- [ ] Audit-Log auf auffällige Fehlversuche durchsehen
- [ ] Rückmeldungen als GitHub-Issues erfassen: **blockierend** (Datenverlust, Anmeldung unmöglich, Sicherheitslücke) oder **später**

Abschluss nach zwei Wochen:

- [ ] Keine offenen blockierenden Fehler
- [ ] Mindestens eine Test-Wiederherstellung im Pilotzeitraum erfolgreich
- [ ] Entscheidung: Freigabe für alle 10 bis 20 Benutzer (Meilenstein 5) oder Nacharbeit
