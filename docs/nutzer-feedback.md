# Nutzer-Feedback mit DerNörgelndeUser

Für Rückmeldungen zur Bedienung gibt es im Repo den Claude-Code-Subagenten `.claude/agents/der-noergelnde-user.md`
(Agent-Name `der-noergelnde-user`, weil Agent-Namen nur Kleinbuchstaben und Bindestriche haben dürfen). Er spielt einen
kritischen, ungeduldigen Endbenutzer: Er startet den aktuellen Build, klickt sich im Browser durch echte Aufgaben und
meldet Bugs, Bedienfehler und Verbesserungsvorschläge. Jeder Fund ist nachgestellt und hat einen Vorschlag.

## Was er darf und was nicht

- **Läuft nur auf Aufruf.** Die Beschreibung des Agenten verbietet, ihn von sich aus oder nach anderen Aufgaben zu
  starten; es gibt keinen Hook und keinen Zeitplan dafür.
- **Ändert keinen Code.** Er hat Read, Grep, Glob und Bash. Die Shell braucht er, um das Wiki zu starten und Chromium
  über Playwright zu steuern. Dass er im Repo nichts schreibt, steht in seinem Auftrag (anders als beim
  `security-reviewer` hängt es hier also am Prompt, nicht an den Werkzeugen); am Ende vergleicht er `git status` mit dem
  Stand vom Anfang und meldet Abweichungen. Hilfsskripte und Screenshots landen im Scratchpad.
- **Restrisiko Prompt-Injection.** Der Agent liest Wiki-Inhalte und hat eine Shell. Sein Auftrag sagt, dass Inhalte nur
  Daten sind, dass er nur mit `localhost` und der genannten Wiki-Adresse spricht und im Live-Modus nur seinen eigenen
  Test-Space öffnet. Erzwungen wird das nicht. Deshalb lokal prüfen lassen oder gegen eine Staging-Instanz, deren
  Inhalte nur vertraute Personen schreiben.
- **Eigene Daten.** Lokal nutzt er die Datenbank `wiki_ux`, Redis-DB 13 und die Weboberfläche auf `127.0.0.1:3200`;
  Entwicklung (`wiki`), API-Tests (`wiki_test`, Redis 15) und E2E (`wiki_e2e`, Redis 14) bleiben unberührt. Die API
  läuft wie bei den E2E-Tests auf Port 3001. Ist einer der Ports belegt, bricht er ab, statt gegen die fremde Instanz zu
  testen. Testkonten bekommen Adressen unter `wiki-ux.invalid`, Mails gehen also nirgends hin.
- **Laufendes Wiki nur mit Testkonto.** Gegen eine echte Installation (besser Staging als Produktion) prüft er nur,
  wenn die Adresse im Auftrag steht und das Testkonto in den Umgebungsvariablen `WFD_UX_EMAIL`, `WFD_UX_PASSWORD` und
  `WFD_UX_TOTP_SECRET` (2FA ist Pflicht). Das Konto sollte kein Admin sein; nach dem Lauf das Passwort wechseln. Er
  arbeitet nur in einem eigenen Test-Space: keine fremden Seiten, keine Einladungen oder Rechte, keine Admin-Einstellungen,
  eine Anmeldung pro Lauf, Uploads höchstens 5 MB.
- Office-Editor und draw.io brauchen eigene Container; lokal stehen sie meist unter „Nicht geprüft“.

## Aufrufen

In Claude Code im Repo (lokal oder in einer Cloud-Sitzung) oder in einem Projekt-Thread auf claude.ai darum bitten:

```text
Lass DerNörgelndeUser den aktuellen Build prüfen.
Lass den nörgelnden User den Seiteneditor und die Anhänge durchgehen.
Lass DerNörgelndeUser den aktuellen Branch gegen main prüfen.
Lass DerNörgelndeUser https://staging.wiki.example.com prüfen (Testkonto in WFD_UX_EMAIL/WFD_UX_PASSWORD/WFD_UX_TOTP_SECRET).
```

Alternativ über `/agents` auswählen. Ein Rundgang dauert je nach Umfang einige Minuten, weil vorher `pnpm build` läuft.

## Der Bericht

Der Agent gibt eine Liste zurück, sortiert nach Schwere (Blocker, Hoch, Mittel, Niedrig). Jeder Fund hat:

- **Art:** Bug, Bedienfehler oder Verbesserung
- **Wo** und **Schritte zum Nachstellen**
- **Erwartet** und **Tatsächlich** mit Beleg (Bildschirmtext, Konsole, HTTP-Status, Screenshot)
- **Gemecker** (ein Satz Benutzersicht) und **Vorschlag**

Dazu kommen „Was gut war“, „Nicht geprüft“, Auffälligkeiten für den `security-reviewer` und der Repo-Zustand.

Die aufrufende Sitzung postet den Bericht unverändert im Hauptchat des Projekts. Ein Projekt-Thread kann dort nicht
selbst schreiben; er reicht den Bericht an den Projekt-Chat weiter und verlinkt ihn im Thread.

## Vom Fund zum Fix

Fabian entscheidet, welche Funde behoben werden. Jeder Fix läuft als normaler PR; für Änderungen an Anmeldung, Rechten,
Anhängen und den anderen Bereichen aus [security-review.md](security-review.md) gehört der `security-reviewer` dazu, für
`apps/android` gilt die Pflicht aus `CLAUDE.md`. Nach dem Fix kann DerNörgelndeUser den Bereich gezielt noch einmal
prüfen.
