# Betrieb

Alles Wiederkehrende läuft über `wikictl` (vom Installer nach `/usr/local/bin/wikictl` verlinkt) und drei systemd-Timer. `sudo wikictl help` zeigt alle Befehle.

## Überblick

| Aufgabe | Befehl | Automatisch |
| --- | --- | --- |
| Zustand ansehen | `sudo wikictl status` | |
| Logs | `sudo wikictl logs [caddy\|web\|api\|db\|redis]` | |
| Update | `sudo wikictl update [git-ref]` | |
| Sicherung | `sudo wikictl backup` | täglich ca. 3:15 Uhr (`wikifordummys-backup.timer`) |
| Test-Wiederherstellung | `sudo wikictl restore-test` | am 1. jedes Monats (`wikifordummys-restore-test.timer`) |
| Wiederherstellung | `sudo wikictl restore <id\|latest>` | |
| Health-Check mit Push | `sudo wikictl monitor` | alle 5 Minuten (`wikifordummys-monitor.timer`) |
| Mailversand prüfen | `sudo wikictl mail-test --to ich@firma.de` | |
| Weiteren Admin anlegen | `sudo wikictl create-admin --email … --name "…"` | zeigt ein Startpasswort an; `--invite` für Einladungslink per Mail |
| Passwort zurücksetzen ohne Mail | `sudo wikictl reset-password --email …` | neues Startpasswort, alle Sitzungen enden, 2FA bleibt |
| Einstellungen ändern | `sudo wikictl reconfigure` (startet den Installer) | |

Timer ansehen: `systemctl list-timers 'wikifordummys-*'`, letzte Läufe: `journalctl -u wikifordummys-backup.service`.

## Updates

```bash
sudo wikictl update            # neuester Stand des aktuellen Branches
sudo wikictl update v0.4.0     # bestimmter Tag oder Commit
```

Das Update sichert zuerst (mit restic, sonst nur die Datenbank nach `/var/backups/wikifordummys/`), holt den Code, baut die Images neu, startet die Container und wartet, bis die API gesund ist. Datenbankmigrationen spielt die API beim Start selbst ein. Schlägt der Start fehl, nennt `wikictl` den vorherigen Stand; mit `sudo wikictl update <alter-commit>` geht es zurück (bei Migrationen zusätzlich `wikictl restore`).

Ubuntu-Sicherheitsupdates laufen automatisch (unattended-upgrades), sofern im Installer gewählt. Docker-Basis-Images werden bei `wikictl update` mit `--pull` aktualisiert.

## Sicherung

Gesichert werden mit [restic](https://restic.net) (verschlüsselt, dedupliziert, versioniert):

- die Datenbank als SQL-Export (`pg_dump`),
- alle Anhänge (Volume `attachments`),
- die Zertifikate und die interne Zertifizierungsstelle von Caddy (Volume `caddy_data`),
- die Datei `.env` mit allen Schlüsseln.

Aufbewahrung: 7 tägliche, 4 wöchentliche, 6 monatliche Stände. Redis enthält nur Sitzungen und Sperren und wird nicht gesichert.

**Das Passwort der Sicherung** (`BACKUP_PASSWORD` in `.env`) zusätzlich außerhalb des Servers aufbewahren, z. B. im Passwortmanager. Ohne es ist die Sicherung nicht lesbar, und auf einem neuen Server gibt es die `.env` ja noch nicht.

Ziele (Eingabe im Installer, gespeichert als `BACKUP_REPOSITORY`):

| Ziel | Format |
| --- | --- |
| Zweite Platte, NAS-Mount, USB-Platte | `/mnt/backup/wikifordummys` |
| Anderer Server, NAS per SSH | `sftp:benutzer@nas.firma.lan:/backup/wiki` (SSH-Schlüssel von root, gibt der Installer aus) |
| S3-kompatibel (Hetzner, Wasabi, Backblaze, MinIO, AWS) | `s3:https://<endpunkt>/<bucket>/<pfad>` plus Access Key |
| restic REST-Server | `rest:https://benutzer:passwort@backup.firma.de:8000/wiki` |

Eine Sicherung auf derselben Platte schützt nicht vor Plattenausfall; der Installer warnt in dem Fall. Empfehlung: ein Ziel außer Haus.

`BACKUP_PING_URL` (optional) wird nach jeder erfolgreichen Sicherung aufgerufen, bei Fehlern mit `/fail` (passt zu healthchecks.io und Uptime-Kuma-Push). Bleibt die Meldung aus, alarmiert der Dienst.

### Test-Wiederherstellung

`wikictl restore-test` (monatlich automatisch, Konzept: „Wiederherstellung einmal im Quartal üben“) holt den neuesten Stand, spielt die Datenbank in einen Wegwerf-Container ohne Netzwerk ein, prüft jeden Anhang anhand seiner SHA-256-Prüfsumme aus der Datenbank, prüft eine Stichprobe von 5 % der Daten im Repository (`restic check`) und meldet das Ergebnis. Das laufende Wiki bleibt unberührt.

### Wiederherstellung auf demselben Server

```bash
sudo wikictl snapshots                 # Stände auflisten
sudo wikictl restore latest            # oder eine ID aus der Liste
```

Vorher sichert `wikictl` den aktuellen Stand (Markierung `vor-wiederherstellung`, wird nicht automatisch gelöscht). Dann werden Datenbank, Anhänge und Zertifikate ersetzt; alle Benutzer müssen sich neu anmelden.

### Wiederherstellung auf einem neuen Server

1. Neuen Server wie in [installation.md](installation.md) aufsetzen, mit **derselben Domain** und demselben Sicherungsziel; bei der Frage nach dem Passwort der vorhandenen Sicherung das alte Passwort eingeben. Bei der Frage nach dem Administrator „nein“ wählen.
2. Dann

   ```bash
   sudo wikictl snapshots
   sudo wikictl restore latest --with-env
   ```

   `--with-env` übernimmt die alte `.env` mit `ENCRYPTION_KEY`; nur so bleiben die Zwei-Faktor-Einrichtungen und das SMTP-Passwort aus der Administration gültig.
3. DNS auf den neuen Server umstellen.

## Überwachung

- **Health-Endpunkt** `https://<domain>/api/v1/health` liefert `{"status":"ok","checks":{"database":"ok","redis":"ok","disk":"ok"}}` bzw. HTTP 503. Für Uptime Kuma, UptimeRobot, Zabbix o. ä. als HTTP-Monitor mit Stichwort `"status":"ok"` eintragen. `disk` wird `knapp`, wenn weniger als 10 % frei sind.
- **Push** `MONITOR_PING_URL`: alle 5 Minuten ruft `wikictl monitor` die Adresse auf, solange das Wiki gesund ist (bei Fehlern `…/fail`). Damit fällt auch ein komplett ausgefallener Server auf.
- **Container-Healthchecks**: `sudo wikictl status` bzw. `docker compose ps` zeigt `healthy` für API und Weboberfläche.
- **Zertifikat**: `wikictl status` zeigt Ablaufdatum und Aussteller. Caddy erneuert selbst; ein Ablaufdatum in weniger als 20 Tagen deutet auf ein Problem (DNS, Port 80/443) hin.
- **Sicherung**: `wikictl status` zeigt den letzten Stand; dazu `BACKUP_PING_URL`.

## Logs

Alle Dienste schreiben auf stdout; Docker begrenzt das auf 3 × 50 MB je Dienst. Caddy schreibt Zugriffe als JSON. Fehlgeschlagene Anmeldungen erscheinen in der API als JSON-Zeile (`"audit":"auth.login.failed"` mit IP); vollständig stehen sie im Audit-Log der Administration (365 Tage).

## fail2ban

Wenn im Installer gewählt (nur bei direkter Erreichbarkeit, nicht hinter einem Proxy): Nach 10 fehlgeschlagenen Anmeldungen oder 2FA-Versuchen in 10 Minuten wird die IP für eine Stunde gesperrt. Das ergänzt die Rate-Limits der API (S3). Die Regel sitzt in der iptables-Kette `DOCKER-USER`, weil Docker veröffentlichte Ports an der normalen Firewall vorbeileitet. Private Netze werden nie gesperrt.

```bash
sudo fail2ban-client status wikifordummys        # gesperrte IPs
sudo fail2ban-client set wikifordummys unbanip 203.0.113.7
```

## Sicherheitshinweise für den Betrieb

- SSH nur mit Schlüssel, Root-Login aus (`/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`).
- `.env` enthält alle Schlüssel und ist nur für root lesbar. Nicht ins Repository, nicht per Mail.
- Den Admin-Bereich bei Bedarf zusätzlich auf bestimmte IPs beschränken (im vorgeschalteten Proxy oder per VPN).
- Nach dem Zurücksetzen der 2FA einer Person deren Identität prüfen (z. B. telefonisch).
