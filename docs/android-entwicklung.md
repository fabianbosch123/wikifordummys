# Android-Entwicklung mit dem Subagenten

Für die Entwicklung einer Android-App gibt es im Repo einen eigenen Claude-Code-Subagenten:
`.claude/agents/android-developer.md`. Er schreibt Kotlin mit Jetpack Compose und Material 3, pflegt das Gradle-Projekt
(Kotlin DSL, Versionskatalog) und schreibt Tests. Standardmäßig arbeitet er am Android-Client für dieses Wiki unter
`apps/android`; nennt der Auftrag eine andere App oder einen anderen Ordner, baut er diese.

Anders als der `security-reviewer` hat er Schreibrechte und eine Shell (Read, Grep, Glob, Edit, Write, Bash), weil er Code
anlegen und Gradle ausführen muss. Committen, pushen und den PR öffnen macht die aufrufende Sitzung, nach einem Security-Review (siehe unten).

## Wann

- Grundgerüst der App anlegen, solange `apps/android` noch fehlt.
- Neue Bildschirme und Abläufe (Anmeldung, Spaces, Seitenbaum, Seite lesen, Suche, Anhänge).
- Abhängigkeiten, Gradle und SDK-Versionen pflegen, Lint-Warnungen beheben.
- Abstürze und Fehler in der App suchen und beheben.

## Aufrufen

In Claude Code im Repo (lokal oder in einer Cloud-Sitzung) einfach darum bitten, der Subagent wird über seinen Namen gewählt:

```text
Lass den android-developer das Grundgerüst der App unter apps/android anlegen.
Lass den android-developer einen Bildschirm bauen, der die Spaces des Wikis auflistet.
Lass den android-developer die Abhängigkeiten der App aktualisieren.
```

Alternativ über `/agents` auswählen. In einem Projekt-Thread auf claude.ai reicht derselbe Satz.

Der Subagent liefert einen kurzen Bericht zurück: geänderte Dateien, was gebaut und getestet wurde, was nicht geprüft werden
konnte, offene Entscheidungen und Vorschläge für Änderungen am Server.

## Security-Review vor jedem PR

Jeder PR mit Änderungen an der App geht erst an Fabian, wenn der `security-reviewer` den Diff geprüft hat. Weil ein
Subagent keinen weiteren Subagenten starten kann und der `security-reviewer` keine Shell hat, steuert das die aufrufende
Sitzung:

1. Der `android-developer` baut und schreibt den Diff gegen `main` in eine Datei; den Pfad nennt er im Bericht.
2. Die aufrufende Sitzung lässt den `security-reviewer` diesen Diff prüfen.
3. Bei Critical, High oder Medium gibt sie die Findings an den `android-developer` zurück; er behebt sie, danach läuft der
   Review noch einmal über den neuen Diff.
4. Erst dann öffnet sie den PR, mit einem Abschnitt „Security-Review“: Ergebnis, behobene Findings und was offen bleibt
   (Low, Info, offene Entscheidungen). Kein Critical/High darf offen sein; ein offenes Medium nur mit Begründung.

Die Regel steht auch in `CLAUDE.md` im Repo-Wurzelverzeichnis, damit jede Sitzung sie kennt, nicht nur der Subagent.

## Bauen und testen

Der Subagent führt in `apps/android` `./gradlew assembleDebug testDebugUnitTest lintDebug` aus, wenn ein JDK (17 oder neuer)
und das Android SDK (`ANDROID_HOME`) vorhanden sind. In einer Cloud-Sitzung fehlt das SDK in der Regel; dann schreibt er den
Code trotzdem und sagt im Bericht genau, was nicht gebaut wurde. Bauen und Testen auf dem eigenen Rechner (Android Studio
oder `./gradlew` im Terminal) bleibt dann der letzte Schritt.

## Was der Subagent bewusst nicht entscheidet

- **Anmeldung der App.** Entschieden (2026-10-28): OAuth 2.1 mit PKCE über den Browser, mit einem fest eingebauten
  App-Client. App-Tokens gelten an der REST-API nur lesend und nur für Spaces, Seiten, Suche, Anhänge und das eigene Profil;
  Konto, Tokens und Administration bleiben der Weboberfläche. Erweiterungen (z. B. Bearbeiten in der App) sind eine neue
  Entscheidung mit eigenem Server-PR.
  Restrisiko: Der Rücksprung läuft über das private Schema `de.wikifordummys.app:`, das auch eine fremde App auf dem Gerät
  beanspruchen kann. Deshalb gilt eine App-Zustimmung höchstens 30 Tage, und die Zustimmungsseite warnt davor. Der bessere
  Weg ist ein verifizierter App Link auf der Wiki-Domain (`/.well-known/assetlinks.json` mit dem Signaturzertifikat), sobald
  die App signiert veröffentlicht wird.
- **Änderungen am Server.** Braucht die App neue Endpunkte, Bearer-Anmeldung an der REST-API oder CORS, schlägt er das vor,
  ändert `apps/api` aber nicht. Solche Änderungen laufen als eigener PR und, weil sie Anmeldung und Rechte betreffen, über den
  `security-reviewer` (siehe [security-review.md](security-review.md)).
- **Produktumfang** wie Offline-Bearbeitung oder Push-Benachrichtigungen.
