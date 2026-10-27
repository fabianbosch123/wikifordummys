# Claude und andere KI-Assistenten (MCP-Server)

Das Wiki hat einen eingebauten [MCP-Server](https://modelcontextprotocol.io) (Model Context Protocol). Darüber kann Claude
(Claude Code, Claude Desktop und andere MCP-Clients) im Wiki lesen, suchen, Seiten anlegen und ändern sowie draw.io-Zeichnungen
anlegen und ändern.

- Adresse: `https://<deine-domain>/api/v1/mcp` (Streamable HTTP, zustandslos)
- Anmeldung: per OAuth (claude.ai, auch App und Projekte) oder mit persönlichem API-Token im Header `Authorization: Bearer wfd_…`
  (Claude Code, Claude Desktop, andere Clients)
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

Hier braucht es kein Token, die Anmeldung läuft über OAuth:

1. In claude.ai **Einstellungen → Connectors → „Eigenen Connector hinzufügen“**, Name z. B. „Wiki“, Adresse
   `https://wiki.example.de/api/v1/mcp`. Client-ID und -Geheimnis bleiben leer (Claude registriert sich selbst).
2. Auf **Verbinden** klicken. claude.ai öffnet die Seite **Zugriff auf das Wiki** im Wiki. Wer nicht angemeldet ist, meldet sich
   zuerst wie gewohnt an (Passwort und 2FA) und landet danach wieder dort.
3. Die Seite zeigt, welche Anwendung zugreifen will und wohin es danach zurückgeht (claude.ai). Rechte und Gültigkeit wählen, den
   aktuellen Code aus der Authenticator-App eingeben, **Zulassen**.
4. Der Connector steht dann in claude.ai in Chats und Projekten zur Verfügung (im Chat über „+“ → Connectors einschalten).
   In Organisationen (Team, Enterprise) fügt ein Owner den Connector einmal hinzu; jeder Benutzer verbindet dann sein eigenes Konto.

Die Verbindung erscheint im Profil unter „Claude und andere KI-Assistenten (MCP)“ als **Connector (OAuth)** und lässt sich dort
widerrufen. Claude erneuert seinen Zugang selbst, bis die gewählte Gültigkeit abläuft; danach einfach in claude.ai neu verbinden.

**Voraussetzung:** claude.ai ruft das Wiki aus dem Internet auf. Das klappt nur, wenn das Wiki öffentlich erreichbar ist und ein
öffentlich gültiges Zertifikat hat (Betriebsart `letsencrypt` oder `proxy`), nicht mit `internal`.

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
- **OAuth (claude.ai):** OAuth 2.1 nach der MCP-Spezifikation. Metadaten unter `/.well-known/oauth-protected-resource` und
  `/.well-known/oauth-authorization-server` (Caddy reicht sie an die API weiter), Dynamic Client Registration, Autorisierungscode nur
  mit PKCE (S256), Rücksprung nur an fest registrierte Adressen.
  - **Rücksprung nur zu Claude:** Clients dürfen sich nur mit Rücksprungadressen bei `claude.ai` und `claude.com` (https) oder auf
    dem eigenen Rechner (`http://localhost`, `127.0.0.1`) registrieren. Andere Hosts erlaubt `OAUTH_REDIRECT_HOSTS` in `.env`
    (kommagetrennt, z. B. `OAUTH_REDIRECT_HOSTS=claude.ai,claude.com,beispiel.de`). So kann niemand eine eigene Anwendung
    registrieren, die Benutzer per Link zur Zustimmung bringt und den Zugang an sich selbst schicken lässt.
  - **Zustimmung** nur mit vollständiger Anmeldung im Wiki und aktuellem 2FA-Code. Die Seite zeigt den Ziel-Host groß an; der
    Name der Anwendung stammt vom Client selbst und ist nur ein Hinweis.
  - **Tokens:** Access-Tokens (`wfd_…`) gelten eine Stunde, Refresh-Tokens (`wfr_…`) werden bei jeder Erneuerung ausgetauscht.
    Wird ein schon ersetztes Refresh-Token noch einmal vorgelegt, endet die ganze Verbindung (`oauth.refresh.reused`). Beide liegen
    nur als SHA-256 in der Datenbank; Codes gelten 10 Minuten und nur einmal. Eine Verbindung je Benutzer und Anwendung: neu
    verbinden ersetzt die alte.
  - Für Verbindungen gilt alles wie für Tokens: dieselben Rechte, dieselben Rate-Limits, Widerruf im Profil und durch Admins, automatischer
    Widerruf bei Passwort-Reset, 2FA-Reset, „Alle Sitzungen beenden“ und Deaktivieren; bei ausgeschaltetem MCP-Server gibt es auch keine
    neuen Tokens. Registrierungen sind auf 10 pro Stunde und IP begrenzt, der Token-Endpunkt auf 60 Anfragen pro Minute und IP;
    Registrierungen ohne Zustimmung werden nach einem Tag gelöscht.
- **Audit-Log:** `token.created`, `token.revoked`, `admin.token.revoked`, `admin.settings.mcp.updated`, `mcp.auth.failed` sowie jede
  Änderung über MCP (`mcp.page.created`, `mcp.page.updated`, `mcp.drawing.created`, `mcp.drawing.updated`) mit Benutzer, IP und
  Token, außerdem `oauth.client.registered`, `oauth.authorized`, `oauth.denied`, `oauth.revoked` und `oauth.refresh.reused`. Filter
  „Claude (MCP)“, „API-Tokens“ und „Connectors (OAuth)“ in Administration → Audit-Log. Seiten- und Anhangversionen tragen den Benutzer des Tokens.
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
| claude.ai: „Rücksprung zu … ist nicht erlaubt“ | Der Client nutzt einen Host außerhalb von `OAUTH_REDIRECT_HOSTS` |
| claude.ai: Verbinden scheitert ohne Zustimmungsseite | Wiki nicht aus dem Internet erreichbar, kein öffentliches Zertifikat oder MCP-Server ausgeschaltet; prüfen mit `curl https://wiki.example.de/.well-known/oauth-authorization-server` |
