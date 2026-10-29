# Umzug auf einen anderen Server

`wikictl export` packt das ganze Wiki in eine verschlüsselte Datei, `wikictl import` spielt sie auf einem frisch installierten Server ein und prüft das Ergebnis. Das passt für den Wechsel auf einen neuen VPS, auf eigene Hardware oder auf ein neueres Ubuntu, auch mit neuer Domain.

Wer schon eine restic-Sicherung an einem Ziel hat, das auch der neue Server erreicht (S3, SFTP, REST), kann stattdessen `wikictl restore latest --with-env` verwenden ([betrieb.md](betrieb.md#wiederherstellung-auf-einem-neuen-server)). Die Umzugsdatei braucht kein gemeinsames Sicherungsziel, hält das Wiki beim Packen kurz an (nichts geht zwischen Export und Umzug verloren), prüft Version und Prüfsummen und lässt dem neuen Server seine eigene Domain, Betriebsart und Sicherung.

## Was in der Umzugsdatei steckt

| Inhalt | Herkunft |
| --- | --- |
| Datenbank (Benutzer, Spaces, Seiten, Versionen, Rechte, Audit-Log, Einstellungen, API- und OAuth-Tokens) | `pg_dump` |
| Anhänge mit allen Fassungen, auch Office-Dateien und draw.io-Zeichnungen | Volume `attachments` |
| Zertifikate, Let's-Encrypt-Konto und interne Zertifizierungsstelle von Caddy | Volume `caddy_data` |
| `.env` mit allen Schlüsseln | `/opt/wikifordummys/.env` |
| Manifest: Code-Stand (Commit), Images, Domain, Betriebsart, Zählerstände | erzeugt beim Export |
| SHA-256-Prüfsumme jeder Datei | erzeugt beim Export |

Nicht enthalten sind Redis (nur Sitzungen und Sperren, alle melden sich nach dem Umzug neu an), die Daten des Office-Editors (er speichert keine Dokumente dauerhaft) und die restic-Sicherungen des alten Servers.

Die Datei ist mit gpg verschlüsselt (AES-256, Passwort mit SHA-512 gestreckt, Integritätsschutz) und hat die Rechte 600. Das Passwort erzeugt `wikictl export` und zeigt es **einmal** an; gespeichert wird es nirgends.

## Ablauf

### 1. Neuen Server vorbereiten

Den neuen Server wie in [installation.md](installation.md) installieren, aber:

- **Domain:** die künftige Adresse. Bleibt sie gleich, warnt der Installer, dass DNS noch auf den alten Server zeigt; das ist in Ordnung.
- **Erster Administrator:** „nein“ wählen, die Benutzer kommen aus der Umzugsdatei.
- **Sicherung:** ein **eigenes** Ziel oder ein neues Verzeichnis im alten Ziel, nicht dasselbe restic-Repository des alten Servers.
- Mailversand, Office-Editor und draw.io müssen nicht passen: Diese Einstellungen übernimmt der Import vom alten Server.

Der neue Server muss denselben Code-Stand haben wie der alte. Auf dem alten Server zeigt `sudo wikictl status` die Version; auf dem neuen gleicht `sudo wikictl update <commit>` an. Der Import prüft das und nennt den Befehl, falls es nicht passt.

### 2. Auf dem alten Server exportieren

```bash
sudo wikictl export --stop
```

- Weboberfläche, API und Caddy werden für die Dauer des Exports angehalten, damit nichts mehr geschrieben wird. Die Datenbank läuft weiter.
- `--stop` lässt danach **alle Dienste aus**: Niemand kann mehr auf dem alten Server arbeiten, und nichts geht verloren. Für einen Probelauf ohne `--stop` aufrufen; dann startet das Wiki gleich wieder.
- Die Datei landet unter `/var/backups/wikifordummys/umzug-<host>-<datum>.wiki.gpg`, mit `--output <datei>` woanders. Der Export prüft vorher den freien Platz (etwa so viel wie Anhänge plus doppelte Datenbank).
- Am Ende stehen Dateigröße, SHA-256 der Datei und das **Passwort**. Beides notieren, z. B. im Passwortmanager.

Für Skripte lässt sich ein eigenes Passwort (mindestens 16 Zeichen) über die Umgebungsvariable `WIKI_EXPORT_PASSPHRASE` vorgeben; das gilt auch für den Import.

### 3. Datei übertragen

```bash
# auf dem alten Server
sudo scp /var/backups/wikifordummys/umzug-*.wiki.gpg admin@neuer-server:/tmp/
# auf dem neuen Server: gleiche Prüfsumme wie beim Export?
sha256sum /tmp/umzug-*.wiki.gpg
```

Das Passwort nicht zusammen mit der Datei verschicken (nicht in dieselbe Mail, nicht in dieselbe Datei).

### 4. Auf dem neuen Server importieren

```bash
sudo wikictl import /tmp/umzug-alt-2026-10-29-1400.wiki.gpg
```

Der Import

1. fragt das Passwort ab, entschlüsselt in ein temporäres Verzeichnis (Rechte 700) und bricht bei falschem Passwort oder veränderter Datei ab,
2. prüft die Prüfsumme jeder Datei und lehnt Verknüpfungen, Gerätedateien und Dateien ohne Prüfsumme ab,
3. vergleicht den Code-Stand (muss gleich sein) und die Images (Abweichungen nur als Warnung),
4. zeigt alt und neu (Server, Domain, Betriebsart, Inhalt) und wartet auf die Eingabe `UMZIEHEN` (ohne Rückfrage mit `--yes`),
5. übernimmt aus der alten `.env` die Schlüssel und Wiki-Einstellungen (siehe unten), die bisherige `.env` bleibt als `.env.vor-import`,
6. legt die Datenbank neu an, spielt Datenbank, Anhänge und, bei gleicher Domain und Betriebsart, die Zertifikate ein, verwirft alle Sitzungen und startet,
7. vergleicht Benutzer, Spaces, Seiten und Anhänge mit dem Manifest, prüft jeden Anhang und jede ältere Fassung anhand der SHA-256 aus der Datenbank und wartet auf API, draw.io und Office-Editor.

Danach `sudo wikictl status` aufrufen.

### 5. Testen, DNS umstellen, aufräumen

1. **Vor der DNS-Umstellung testen:** auf dem eigenen Rechner in der hosts-Datei die Domain auf die IP des neuen Servers zeigen lassen (`/etc/hosts` bzw. `C:\Windows\System32\drivers\etc\hosts`) und im Browser anmelden. Bei gleicher Domain hat der neue Server die Zertifikate des alten und zeigt sofort ein gültiges an.
2. **DNS umstellen** (A- bzw. AAAA-Eintrag auf die neue IP). Tipp: die TTL des Eintrags ein, zwei Tage vorher auf 300 Sekunden senken. Danach den hosts-Eintrag wieder entfernen.
3. **Erste Sicherung** auf dem neuen Server: `sudo wikictl backup`, dann `sudo wikictl restore-test`.
4. **Umzugsdatei löschen** auf beiden Servern (`sudo shred -u <datei>` bzw. `rm`), sobald alles läuft.
5. **Alten Server abschalten:** Timer stoppen, damit Überwachung und Sicherung nicht weiter melden oder in das alte Ziel schreiben:

   ```bash
   sudo systemctl disable --now wikifordummys-backup.timer wikifordummys-monitor.timer wikifordummys-restore-test.timer
   ```

   Die Daten dort erst löschen, wenn der neue Server einige Tage läuft und gesichert ist.

## Was übernommen wird und was beim neuen Server bleibt

| Aus der alten `.env` übernommen | Vom Installer des neuen Servers |
| --- | --- |
| `ENCRYPTION_KEY` (2FA und SMTP-Passwort aus der Administration), `SESSION_SECRET` | `WIKI_DOMAIN`, `WIKI_TLS`, Ports, Proxy-Einstellungen, `WIKI_IPV6` |
| `SMTP_URL`, `MAIL_FROM` | `BACKUP_*`, `MONITOR_PING_URL` |
| `WIKI_OFFICE`, `WIKI_DRAWIO`, `OFFICE_VERSION` | `DB_PASSWORD`, `REDIS_PASSWORD`, `OFFICE_JWT_SECRET` (gelten nur auf dem Server selbst) |
| Grenzen für Anhänge (`ATTACHMENT_*`, `RATE_UPLOADS_PER_HOUR`), `OAUTH_REDIRECT_HOSTS` | alles andere |

Zwei-Faktor-Anmeldung, Passwörter, API-Tokens und SMTP-Zugang aus der Administration funktionieren damit unverändert weiter. Hat der neue Server weniger als 8 GB Arbeitsspeicher und lief auf dem alten der Office-Editor, danach `sudo wikictl office off`.

## Neue Domain

Der Import funktioniert auch mit neuer Domain; das Wiki ist danach unter der neuen Adresse erreichbar. Folgendes hängt aber an der alten Adresse:

- **Android-App:** Die App merkt sich die Wiki-Adresse und spricht weiter die alte an. In der App abmelden, neue Adresse eingeben und neu anmelden (die Anmeldung läuft über OAuth mit der Domain als Aussteller).
- **claude.ai-Connectors und MCP-Clients:** Die MCP-Adresse (`https://<domain>/api/v1/mcp`) und der OAuth-Aussteller ändern sich. Den Connector in claude.ai entfernen und mit der neuen Adresse neu hinzufügen. Persönliche API-Tokens bleiben gültig; in Claude Code bzw. Claude Desktop nur die Adresse ändern.
- **Links:** Einladungs- und Passwort-Reset-Links aus alten Mails, Lesezeichen und Links in anderen Systemen zeigen auf die alte Adresse. Links innerhalb des Wikis sind relativ und funktionieren weiter. Wer die alte Domain behält, kann sie auf die neue weiterleiten (z. B. im vorhandenen Proxy oder beim Domain-Anbieter).
- **Zertifikate:** Die des alten Servers werden nicht übernommen; Caddy auf dem neuen Server holt bzw. erzeugt eigene. In der Betriebsart `internal` heißt das: eine neue interne Zertifizierungsstelle, deren Stammzertifikat (`sudo wikictl ca-cert`) erneut auf den Geräten im Netz verteilt werden muss.

Bei gleicher Domain gibt es nichts davon: App, Connectors und Lesezeichen funktionieren nach der DNS-Umstellung weiter, und in der Betriebsart `internal` bleibt die bisherige Zertifizierungsstelle.

## Fehler

| Meldung | Abhilfe |
| --- | --- |
| „Der alte Server lief mit Stand …“ | `sudo wikictl update <commit>` auf dem neuen Server, dann erneut importieren |
| „Entschlüsseln fehlgeschlagen“ | Passwort prüfen; Prüfsumme der Datei mit der beim Export vergleichen, ggf. neu kopieren |
| „Prüfsummen stimmen nicht“ | Datei beim Kopieren beschädigt: neu kopieren |
| „… MB frei“ | Platz schaffen (`sudo wikictl cleanup`) oder beim Export `--output` auf eine größere Platte |
| „Inhalt weicht ab“ bzw. „Anhänge fehlen“ | Import abgebrochen, bevor das Wiki als fertig gilt. Die alte `.env` liegt in `.env.vor-import`; Logs mit `sudo wikictl logs api`. Der alte Server ist unverändert und lässt sich mit `sudo wikictl start` wieder starten |

Ein fehlgeschlagener Import lässt sich mit derselben Datei wiederholen.
