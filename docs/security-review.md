# Security-Reviews mit dem Subagenten

Für Security-Reviews gibt es im Repo einen eigenen Claude-Code-Subagenten: `.claude/agents/security-reviewer.md`. Er liest
Code, findet Lücken und liefert sie im Format des Registers unter `.security-audit/`. Er ändert keinen Code und hat nur
lesende Werkzeuge (Read, Grep, Glob), bewusst ohne Bash: Dass er nichts ausführt, schreibt oder ins Netz schickt, hängt
damit nicht am Prompt, sondern an seinen Werkzeugen. Behoben wird in der aufrufenden Sitzung, über einen normalen PR.

## Wann

- Vor dem Mergen jedes PRs, der Anmeldung, Rechte, Anhänge, Office, draw.io, MCP/OAuth, Installer, `wikictl`, Caddy,
  Compose oder die CI ändert.
- Gezielt für einen Bereich, wenn sich dort viel getan hat (z. B. „prüfe die Anhänge“).
- Zur Nachprüfung offener Findings (Stand nach Audit R1: SEC-007, SEC-011, SEC-014, SEC-015, SEC-016, SEC-018, SEC-020).

Der volle Audit mit Scannern (Gitleaks, Semgrep, OSV, Checkov, zizmor) bleibt Sache des Skills `security-audit`; der
Subagent ist der schnelle Review dazwischen.

## Aufrufen

In Claude Code im Repo (lokal oder in einer Cloud-Sitzung) einfach darum bitten, der Subagent wird über seinen Namen gewählt:

```text
Lass den security-reviewer den aktuellen Branch gegen main prüfen.
Lass den security-reviewer die Anhänge (apps/api/src/attachments) prüfen.
Lass den security-reviewer prüfen, ob SEC-007 und SEC-020 noch bestehen.
```

Alternativ über `/agents` auswählen. Weil der Subagent keine Shell hat, holt die aufrufende Sitzung bei einem Diff-Review
den Diff (`git diff main...HEAD`) und die Commit-Liste (`git log --oneline main..HEAD`) und gibt beides im Auftrag mit;
bei einem großen Diff schreibt sie ihn in eine Datei (z. B. im Scratchpad) und nennt den Pfad. Claude macht das bei den
Sätzen oben von selbst. Fehlt der Diff, meldet der Subagent das, statt zu raten. In einem
Projekt-Thread auf claude.ai reicht derselbe Satz, etwa „mach einen Security-Review mit dem security-reviewer“.

Der Bericht enthält neue Findings (vorläufig `SEC-NEU-1` usw.) mit Schweregrad, Fundstelle, Wirkung und Fix-Empfehlung, eine
Tabelle zum Stand der bekannten Findings, was ohne Befund geprüft wurde und was nicht geprüft wurde.

## Vom Finding zum Fix-PR

1. **Ins Register übernehmen:** Die aufrufende Sitzung vergibt die Nummern ab `nextId` aus `.security-audit/findings.json`,
   trägt die Findings in `findings.json` und `FINDINGS.md` ein und schreibt je Finding eine Zeile `"event": "found"` in
   `history.jsonl`. Falsche Treffer kommen mit Begründung nach `triageDismissals`.
2. **Beheben:** Mit dem Skill `security-fix` („fix SEC-021“) ein Finding nach dem anderen: Ursache benennen, Fix samt
   Test, gleiche Muster anderswo suchen. Status wird `Fixed` mit `rootCause`, `fixNote` und `fixCommit`.
   Was bewusst bleibt, wird als Risiko akzeptiert (mit Begründung und Ablaufdatum, Freigabe durch Fabian).
3. **PR:** Fixes und Register-Änderung zusammen in einem Branch, ein PR. Vor dem Push noch einmal den security-reviewer
   über den Diff laufen lassen; er meldet, ob ein Fix Neues aufreißt.

## Wann security-verify läuft

Der Skill `security-verify` scannt neu, prüft jedes `Fixed`-Finding gegen den Code, öffnet Rückfälle wieder und wendet das
Gate an (Standard: keine offenen Critical/High, jedes Medium behoben oder akzeptiert). Er legt einen neuen Lauf unter
`.security-audit/runs/` an.

- Nach jedem gemergten Fix-PR mit Medium oder höher.
- Vor einem Release oder größeren Update auf dem Server.
- Spätestens alle drei Monate, auch ohne Fixes.

Offen ist derzeit Lauf R2: Er soll die Fixes aus Audit R1 (PR #20) bestätigen.
