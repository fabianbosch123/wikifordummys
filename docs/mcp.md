# Claude und andere KI-Assistenten (MCP-Server)

Das Wiki hat einen eingebauten [MCP-Server](https://modelcontextprotocol.io) (Model Context Protocol). Darüber kann Claude
(Claude Code, Claude Desktop und andere MCP-Clients) im Wiki lesen, suchen, Seiten anlegen und ändern sowie draw.io-Zeichnungen
anlegen und ändern.

- Adresse: `https://<deine-domain>/api/v1/mcp` (Streamable HTTP, zustandslos)
- Anmeldung: persönliches API-Token im Header `Authorization: Bearer wfd_…`
- Rechte: genau die des Benutzers, dem das Token gehört (Space-Rollen und Seiteneinschränkungen gelten unverändert)

## Einrichten

1. **Einschalten (Administrator):** Administration → **Claude (MCP)** → „MCP-Server einschalten“. Standard ist aus.
2. **Konto für Claude (empfohlen):** Ein eigenes Konto anlegen, z. B. „Claude“, und ihm nur in den Spaces, in denen Claude
   schreiben soll, die Rolle Bearbeiter geben (sonst Leser oder gar keine). So sieht man in der Versionsgeschichte sofort, was Claude
   geändert hat, und begrenzt, was ein verlorenes Token anrichten kann. Ein Token eines Administrators hätte Admin-Rechte in allen Spaces.
3. **Token anlegen:** Mit diesem Konto anmelden, **Mein Konto** → „Claude und andere KI-Assistenten (MCP)“: Name, Rechte
   („Nur lesen“ oder „Lesen und schreiben“), Gültigkeit (7 bis 365 Tage) und den aktuellen Code aus der Authenticator-App eingeben.
   Das Token wird **nur einmal** angezeigt; gleich in Claude eintragen.

### Claude Code

```bash
claude mcp add --transport http wiki https://wiki.example.de/api/v1/mcp \
  --header "Authorization: Bearer wfd_…"
```

Mit `--scope user` steht das Wiki in allen Projekten zur Verfügung. Prüfen mit `claude mcp list` bzw. `/mcp` in Claude Code.

### Claude Desktop

Claude Desktop bindet Server mit festem Token über die Konfigurationsdatei und das Hilfsprogramm `mcp-remote` ein (braucht Node.js
auf dem Rechner). Einstellungen → Entwickler → „Konfiguration bearbeiten“, dann in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wiki": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://wiki.example.de/api/v1/mcp", "--header", "Authorization:${WIKI_AUTH}"],
      "env": { "WIKI_AUTH": "Bearer wfd_…" }
    }
  }
}
```

Danach Claude Desktop neu starten. (Das Token steht in `env`, weil Leerzeichen in Argumenten unter Windows Probleme machen.)

### claude.ai (Web, App, Projekte)

Eigene Connectors in claude.ai verlangen eine OAuth-Anmeldung. Die ist noch nicht eingebaut und folgt als eigener Schritt.

### Betriebsart `internal` (eigene Zertifizierungsstelle)

Läuft das Wiki mit dem internen Zertifikat von Caddy, muss der Rechner mit Claude dieser Zertifizierungsstelle vertrauen, z. B. über
`NODE_EXTRA_CA_CERTS=/pfad/zu/wiki-ca.crt` (Claude Code, `mcp-remote`). Das Stammzertifikat gibt `sudo wikictl ca-cert > wiki-ca.crt`
auf dem Server aus.

## Werkzeuge

| Werkzeug | Zweck | Token |
| --- | --- | --- |
| `list_spaces` | Sichtbare Spaces mit Rolle | lesen |
| `get_page_tree` | Seitenbaum eines Spaces | lesen |
| `read_page` | Seite als Markdown (oder TipTap-JSON) mit Version | lesen |
| `search` | Volltextsuche | lesen |
| `read_drawing` | draw.io-XML einer Zeichnung | lesen |
| `create_page` | Seite anlegen (Markdown) | schreiben |
| `update_page` | Seite ändern oder ergänzen (`mode: append`), nur mit aktueller Version | schreiben |
| `create_drawing` | Zeichnung aus draw.io-XML anlegen und unten in die Seite einfügen | schreiben |
| `update_drawing` | Zeichnung durch neues XML ersetzen (neue Fassung, Seite zeigt darauf) | schreiben |

Löschen, Verschieben, Rechte und Administration gibt es über MCP bewusst nicht.

**Markdown:** CommonMark mit Tabellen und Durchstreichen. Hinweisboxen schreibt man als `> [!info]` (auch `note`, `warning`,
`success`), Zeichnungen erscheinen als `![Titel](drawing:<Anhang-ID>?version=<Fassung>)`. HTML wird nicht ausgeführt, sondern bleibt
Text. Unterstreichen, Spaltenbreiten und verbundene Zellen kennt Markdown nicht; wer sie behalten will, liest und schreibt mit
`format: "json"` bzw. `content`.

**Zeichnungen:** Claude liefert draw.io-XML (`<mxfile>` oder `<mxGraphModel>`). Das Wiki speichert es wie draw.io selbst als PNG mit
eingebetteten Daten. Das Bild zeichnet der Server vereinfacht (Rechtecke, Ellipsen, Rauten, Zylinder, Text, Pfeile mit
Beschriftungen); spezielle Symbole wie Cisco-Icons erscheinen als beschriftetes Rechteck. Öffnet jemand die Zeichnung im Wiki mit
draw.io und speichert sie, entsteht das exakte Bild.

## Sicherheit

- **Tokens:** 32 Byte Zufall mit Präfix `wfd_` (erkennbar für Secret-Scanner). In der Datenbank liegt nur der SHA-256, angezeigt wird
  das Token einmal. Anlegen nur mit eingeschaltetem MCP-Zugang und aktuellem 2FA-Code; höchstens 10 aktive Tokens je Benutzer;
  immer mit Ablaufdatum (höchstens 365 Tage). Benutzer widerrufen eigene Tokens im Profil, Administratoren alle unter
  Administration → Claude (MCP).
- **Automatisch widerrufen** werden alle Tokens eines Kontos bei Passwort-Reset (auch `wikictl reset-password`), 2FA-Reset durch einen
  Admin, „Alle Sitzungen beenden“ und Deaktivieren. Konten mit Startpasswort können Tokens nicht nutzen.
- **Nur hier gültig:** Tokens gelten nur für `/api/v1/mcp`, nicht für die übrige API. Umgekehrt zählt am MCP-Endpunkt keine
  Browser-Sitzung (Cookie); Anfragen mit fremdem `Origin` werden abgewiesen (Schutz vor DNS-Rebinding und Aufrufen aus Webseiten).
- **Rechte:** Alle Werkzeuge nutzen dieselben Dienste und Prüfungen wie die Weboberfläche (`PermissionService`, Inhalts-Whitelist S6,
  Anhang-Typprüfung S7). Tokens mit „Nur lesen“ sehen die ändernden Werkzeuge gar nicht.
- **Rate-Limits:** 120 Aufrufe pro Minute und 120 ändernde Aufrufe pro Stunde je Token (`RATE_MCP_PER_MINUTE`,
  `RATE_MCP_WRITES_PER_HOUR`). Nach 10 falschen Tokens wird die IP steigend gesperrt (1 Minute, dann doppelt so lange, höchstens
  1 Stunde); fail2ban wertet `mcp.auth.failed` wie fehlgeschlagene Anmeldungen aus.
- **Audit-Log:** `token.created`, `token.revoked`, `admin.token.revoked`, `admin.settings.mcp.updated`, `mcp.auth.failed` sowie jede
  Änderung über MCP (`mcp.page.created`, `mcp.page.updated`, `mcp.drawing.created`, `mcp.drawing.updated`) mit Benutzer, IP und
  Token. Filter „Claude (MCP)“ und „API-Tokens“ in Administration → Audit-Log. Seiten- und Anhangversionen tragen den Benutzer des Tokens.
- **Was ein Token-Dieb könnte:** alles, was der Benutzer über diese Werkzeuge darf, bis das Token abläuft oder widerrufen ist. Deshalb:
  eigenes Konto mit knappen Rechten, kurze Gültigkeit, und im Zweifel widerrufen. Die Liste zeigt, wann und von welcher IP ein Token
  zuletzt verwendet wurde.

## Fehlersuche

| Meldung | Ursache |
| --- | --- |
| `401 INVALID_TOKEN` | Token falsch, abgelaufen, widerrufen oder Konto deaktiviert |
| `403 MCP_DISABLED` | MCP-Server in der Administration ausgeschaltet |
| `429 RATE_LIMITED` | Zu viele Aufrufe; `retryAfter` sagt, wie lange zu warten ist |
| `CONFLICT … Aktuelle Version: n` | Die Seite wurde inzwischen geändert; neu lesen und darauf aufbauen |
| `NOT_FOUND` | Seite oder Space gibt es nicht oder der Benutzer darf sie nicht sehen |
| `FORBIDDEN` | Der Benutzer darf hier nicht schreiben (Rolle Leser, Bearbeiten-Einschränkung, archivierter Space) |
