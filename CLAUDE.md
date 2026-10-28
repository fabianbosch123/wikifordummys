# Hinweise für Claude

## Android-App (`apps/android`)

- Entwicklung über den Subagenten `android-developer` (`.claude/agents/android-developer.md`), Anleitung in
  `docs/android-entwicklung.md`.
- **Vor jedem PR mit Änderungen unter `apps/android`** den `security-reviewer` über den Diff gegen `main` laufen lassen
  (Diff als Datei übergeben, er hat keine Shell). Critical, High und Medium vom `android-developer` beheben lassen und den
  Review danach wiederholen. Der PR bekommt einen Abschnitt „Security-Review“ mit Ergebnis, behobenen Findings und allem,
  was offen bleibt. Ohne diesen Review geht kein App-PR an Fabian.
