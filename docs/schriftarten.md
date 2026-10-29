# Schriftarten

Der Seiteneditor bietet in der Werkzeugleiste eine Auswahl **Schriftart** mit den zehn im deutschsprachigen Raum gängigsten Schriften. Gespeichert wird nur eine Kennung (`font`-Mark mit `family`, Liste `FONT_FAMILIES` in `packages/shared/src/content.ts`); die API lässt keine anderen Werte zu und entfernt unbekannte Kennungen.

## Lizenzen: was das Wiki ausliefert und was nicht

Arial, Helvetica, Times New Roman, Calibri, Cambria, Verdana, Tahoma, Georgia, Segoe UI und Courier New sind proprietäre Schriften (Microsoft, Monotype, Apple). Ihre Lizenzen erlauben nicht, sie in ein Repository zu legen oder als Webfont auszuliefern. Das Wiki tut das auch nicht:

- In der Schriftliste des Browsers (`apps/web/src/app/fonts.css`) steht der gewohnte Name nur **als Name** vorne. Ist die Schrift auf dem Rechner der Leserin oder des Lesers installiert (Windows, macOS, Office), nimmt der Browser sie von dort.
- Sonst nimmt er eine **freie Ersatzschrift**, die das Wiki selbst ausliefert. Wo es eine gibt, ist sie metrisch kompatibel: gleiche Zeichenbreiten, damit Zeilen und Seitenumbrüche gleich bleiben.
- Die Ersatzschriften liegen unverändert (keine Teilmengen, keine Umbenennung, keine Formatumwandlung) mit ihren Lizenztexten in `fonts/`. Das vermeidet Fragen zu geänderten Fassungen und reservierten Schriftnamen (Carlito hat einen „Reserved Font Name“ nach SIL OFL).
- Ausgeliefert wird nur vom eigenen Server (`/_next/static/media/…`, `font-src 'self'` in der CSP), kein Google-Fonts-CDN und kein anderer fremder Server (DSGVO). Der Browser lädt eine Datei erst, wenn Text in dieser Schrift auf der Seite steht.

## Die zehn Schriften

| Schrift im Editor | Freie Ersatzschrift | Kompatibilität | Warum in der Liste |
| --- | --- | --- | --- |
| Arial | Arimo | metrisch kompatibel | Standard in vielen Firmenvorlagen, Behörden und Formularen |
| Helvetica | Arimo | metrisch kompatibel (Arial hat die Maße von Helvetica) | Klassiker in Gestaltung und Werbung, Systemschrift auf dem Mac |
| Times New Roman | Tinos | metrisch kompatibel | Briefe, Verträge, wissenschaftliche Arbeiten |
| Calibri | Carlito | metrisch kompatibel | Standardschrift von Word, Outlook und PowerPoint 2007 bis 2023, in den meisten Bestandsdokumenten |
| Cambria | Caladea | metrisch kompatibel | Überschriften- und Serifenschrift der Office-Vorlagen |
| Verdana | DejaVu Sans | ähnlich, nicht metrisch gleich | gut lesbar am Bildschirm, häufig in Intranets und E-Mails |
| Tahoma | DejaVu Sans Condensed | ähnlich, nicht metrisch gleich | ältere Windows-Oberflächen, Formulare und Vorlagen |
| Georgia | Gelasio | metrisch kompatibel | Serifenschrift für den Bildschirm, häufig auf Websites und in Newslettern |
| Segoe UI | Open Sans | ähnlich, nicht metrisch gleich | Systemschrift von Windows und Microsoft 365 |
| Courier New | Cousine | metrisch kompatibel | Festbreitenschrift für Code, Konfigurationen und Tabellen in Textform |

Belastbare Zahlen zur Schriftnutzung im deutschsprachigen Raum gibt es nicht. Die Auswahl folgt den Standard- und Systemschriften von Microsoft Office und Windows, die in Firmen hier fast überall im Einsatz sind, ergänzt um Helvetica (macOS, Gestaltung) und Georgia (Web). Nicht in der Liste:

- **Aptos** (Office-Standard seit 2023/24): Dafür gibt es noch keine freie, metrisch kompatible Ersatzschrift.
- **Trebuchet MS** und **Comic Sans**: seltener in Arbeitsdokumenten.
- **Selawik**, Microsofts freie Ersatzschrift für Segoe UI (SIL OFL), wäre metrisch näher an Segoe UI als Open Sans. Ihre Dateien ließen sich aus der Entwicklungsumgebung nicht laden; ein späterer Wechsel ist eine Zeile in `fonts.css` und eine Datei in `fonts/`.

## Lizenzübersicht

Alle Dateien stammen unverändert aus den genannten Quellen (Stand 2026-10-29). Prüfsummen: `fonts/SHA256SUMS` (`cd fonts && sha256sum -c SHA256SUMS`).

| Schrift | Version | Lizenz | Lizenztext im Repo | Quelle (Dateien) | Projekt |
| --- | --- | --- | --- | --- | --- |
| Arimo (Normal, Kursiv; variabel 400–700) | 1.341 | SIL Open Font License 1.1 | `fonts/arimo/OFL.txt` | [google/fonts `ofl/arimo`](https://github.com/google/fonts/tree/main/ofl/arimo) | [googlefonts/arimo](https://github.com/googlefonts/arimo) |
| Tinos (4 Schnitte) | 1.340 | SIL Open Font License 1.1 | `fonts/tinos/OFL.txt` | [google/fonts `ofl/tinos`](https://github.com/google/fonts/tree/main/ofl/tinos) | [googlefonts/tinos](https://github.com/googlefonts/tinos) |
| Cousine (4 Schnitte) | 1.241 | SIL Open Font License 1.1 | `fonts/cousine/OFL.txt` | [google/fonts `ofl/cousine`](https://github.com/google/fonts/tree/main/ofl/cousine) | [googlefonts/cousine](https://github.com/googlefonts/cousine) |
| Carlito (4 Schnitte) | 1.104 | SIL Open Font License 1.1, Reserved Font Name „Carlito“ | `fonts/carlito/OFL.txt` | [google/fonts `ofl/carlito`](https://github.com/google/fonts/tree/main/ofl/carlito) | [googlefonts/carlito](https://github.com/googlefonts/carlito) |
| Caladea (4 Schnitte) | 1.001 | SIL Open Font License 1.1 | `fonts/caladea/OFL.txt` | [google/fonts `ofl/caladea`](https://github.com/google/fonts/tree/main/ofl/caladea) | [huertatipografica/Caladea](https://github.com/huertatipografica/Caladea) |
| Gelasio (Normal, Kursiv; variabel 400–700) | 1.008 | SIL Open Font License 1.1 | `fonts/gelasio/OFL.txt` | [google/fonts `ofl/gelasio`](https://github.com/google/fonts/tree/main/ofl/gelasio) | [SorkinType/Gelasio](https://github.com/SorkinType/Gelasio) |
| Open Sans (Normal, Kursiv; variabel 300–800) | 3.003 | SIL Open Font License 1.1 | `fonts/opensans/OFL.txt` | [google/fonts `ofl/opensans`](https://github.com/google/fonts/tree/main/ofl/opensans) | [googlefonts/opensans](https://github.com/googlefonts/opensans) |
| DejaVu Sans und DejaVu Sans Condensed (je 4 Schnitte) | 2.37 | Bitstream-Vera-Lizenz mit Arev-Ergänzung, DejaVu-Änderungen gemeinfrei | `fonts/dejavu/LICENSE` | npm-Paket [`dejavu-fonts-ttf` 2.37.3](https://www.npmjs.com/package/dejavu-fonts-ttf) (Inhalt des offiziellen Release) | [dejavu-fonts/dejavu-fonts](https://github.com/dejavu-fonts/dejavu-fonts) |

Was die Lizenzen verlangen und wie das Wiki es erfüllt:

- **SIL OFL 1.1:** Nutzen, Weitergeben und Einbetten sind frei, auch kommerziell. Beim Weitergeben müssen Copyright-Hinweis und Lizenz mitgehen: Die Lizenztexte liegen neben den Dateien, und jede Schriftdatei trägt beide unverändert in ihren Metadaten (Name-Tabelle), auch beim Laden im Browser. Die Schriften dürfen nicht allein verkauft werden (tut das Wiki nicht).
- **Bitstream-Vera-Lizenz (DejaVu):** Weitergabe frei mit Copyright- und Lizenzhinweis (`fonts/dejavu/LICENSE`); geänderte Fassungen müssten umbenannt werden (das Wiki ändert nichts).
- Die Lizenzen der Schriften gelten nur für die Schriftdateien; Seiteninhalte im Wiki betreffen sie nicht.

## Office-Editor

Euro-Office (Fork von ONLYOFFICE Docs) bringt eine eigene Schriftausstattung im Image mit. Zusätzlich hängt `docker-compose.yml` den Ordner `fonts/` nur lesend nach `/usr/share/fonts/truetype/custom` ein; mit `GENERATE_FONTS=true` baut der Dokumentserver beim Start seine Schriftliste neu auf. Damit stehen die freien Ersatzschriften auch im Office-Editor zur Auswahl, und Dokumente in Calibri, Cambria, Arial usw. werden mit den metrisch passenden Schriften dargestellt, auch wenn das Image keine eigene Fassung mitbringt.

Welche Schriften das Euro-Office-Image selbst enthält und unter welcher Lizenz, verantwortet sein Herausgeber; das Repository legt keine proprietären Schriften dorthin. Ein Neustart des Dienstes (`sudo wikictl update` oder `docker compose restart office`) übernimmt neue Dateien aus `fonts/`.

## Neue Schrift hinzufügen oder aktualisieren

1. Nur Schriften unter SIL OFL, Apache 2.0, Bitstream-Vera- oder vergleichbar freier Lizenz, die Weitergabe und Einbetten erlauben. Keine Dateien aus Windows, macOS oder Office kopieren.
2. Originaldateien (TTF/OTF) unverändert mit dem Lizenztext in einen eigenen Ordner unter `fonts/` legen, `fonts/SHA256SUMS` neu erzeugen (`cd fonts && sha256sum */*.ttf > SHA256SUMS`).
3. `@font-face` und die Zuordnung `[data-font='…']` in `apps/web/src/app/fonts.css` ergänzen, die Kennung in `FONT_FAMILIES` (`packages/shared/src/content.ts`).
4. Diese Seite (Tabellen oben) nachziehen.

Fällt eine Schrift aus der Liste, zeigt das Wiki betroffenen Text in der Standardschrift; beim nächsten Speichern entfernt die API die unbekannte Kennung, der Text bleibt.
