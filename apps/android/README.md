# wikifordummys für Android

Android-Client für wikifordummys: Kotlin, Jetpack Compose, Material 3 (dynamische Farben ab Android 12, hell und dunkel),
Navigation Compose. Das Projekt ist kein Teil des pnpm-Workspace (deshalb gibt es hier keine `package.json`).

**Stand:** Grundgerüst. Die App fragt beim Start nach der Adresse des Wikis, lässt nur `https://` zu, prüft die Adresse
über `GET /api/v1/health` und speichert sie in einem DataStore. Eine Anmeldung gibt es noch nicht.

## Voraussetzungen

| | Version |
| --- | --- |
| JDK | 17 oder neuer (zum Ausführen von Gradle) |
| Android SDK | Plattform 37 (`compileSdk`/`targetSdk`), Build-Tools passend zum AGP |
| Gradle | über den Wrapper (`./gradlew`, Gradle 9.7.1) |
| Android Gradle Plugin | 9.3.2 |
| Kotlin | 2.4.21 |
| Mindestversion auf dem Gerät | Android 8.0 (API 26) |

Alle Versionen stehen in `gradle/libs.versions.toml`, immer als feste Versionen.

Das SDK findet Gradle über `ANDROID_HOME` oder über `sdk.dir` in `local.properties` (wird von Android Studio angelegt und
nicht eingecheckt).

## Bauen und testen

```bash
cd apps/android
./gradlew assembleDebug          # APK unter app/build/outputs/apk/debug/
./gradlew testDebugUnitTest      # Unit-Tests (JVM, ohne Gerät)
./gradlew lintDebug              # Android Lint
./gradlew installDebug           # auf ein verbundenes Gerät oder einen Emulator installieren
```

Oder das Verzeichnis `apps/android` in Android Studio öffnen.

## Aufbau

```
app/src/main/java/de/wikifordummys/app/
  MainActivity.kt, WikiApplication.kt, AppContainer.kt   Einstieg und manuelle Abhängigkeitsinjektion
  navigation/      Navigation Compose mit typsicheren Zielen
  ui/theme/        Material-3-Theme
  server/model/    Adressprüfung (WikiUrlValidator), Ergebnis der Serverprüfung
  server/data/     DataStore für die Adresse, Health-Check per Retrofit/OkHttp
  server/ui/       Startbildschirm „Wiki-Adresse eingeben“ mit ViewModel
  home/ui/         Platzhalter nach dem Speichern der Adresse
```

Texte stehen in `app/src/main/res/values/strings.xml` (Deutsch als Standard).

## Sicherheit

- Nur HTTPS: `usesCleartextTraffic="false"` und `res/xml/network_security_config.xml` ohne Ausnahmen; die App vertraut nur den
  Zertifizierungsstellen des Systems. Ein Wiki in der Betriebsart `internal` (eigene Zertifizierungsstelle von Caddy) ist deshalb aus der
  App heraus noch nicht erreichbar.
- Kein Backup: `allowBackup="false"` und Regeln, die alle Daten von Cloud-Backup und Geräteübertragung ausschließen.
- Der Health-Check folgt keinen Weiterleitungen und sendet keine Zugangsdaten. Es gibt keinen Logging-Interceptor.
- Keine Geheimnisse im Repo. Für Release-Builds ist keine Signierung konfiguriert; Keystore und Passwörter kommen später aus
  Umgebungsvariablen oder `local.properties`, nie aus dem Repo. `*.jks` und `*.keystore` stehen in `.gitignore`.

## Vor dem ersten Release

1. **Gradle Wrapper neu erzeugen und prüfen.** `gradle-wrapper.jar` wurde in einer Umgebung ohne Zugriff auf
   downloads.gradle.org erzeugt. Auf dem eigenen Rechner einmal `./gradlew wrapper --gradle-version 9.7.1
   --gradle-distribution-sha256-sum <sha256>` ausführen (Prüfsumme von
   https://services.gradle.org/distributions/gradle-9.7.1-bin.zip.sha256). Danach die Prüfsumme der neu erzeugten
   `gradle/wrapper/gradle-wrapper.jar` mit https://services.gradle.org/distributions/gradle-9.7.1-wrapper.jar.sha256
   abgleichen und dabei auch `distributionSha256Sum` in `gradle-wrapper.properties` kontrollieren.
2. **Abhängigkeiten festschreiben.** Mit Zugriff auf Google Maven die Prüfsummen aller Abhängigkeiten erzeugen und
   `gradle/verification-metadata.xml` einchecken:

   ```bash
   ./gradlew --write-verification-metadata sha256 help assembleDebug testDebugUnitTest
   ```

   Ab dann bricht Gradle ab, wenn sich ein Artefakt ändert. Bei Versions-Updates den Befehl erneut ausführen und den
   Diff der Datei prüfen.

Die Repositories in `settings.gradle.kts` sind getrennt: AndroidX-, Android- und die wenigen Google-eigenen Gruppen
kommen ausschließlich aus Google Maven, alles andere ausschließlich aus Maven Central. Fehlt beim Bauen eine Gruppe, die
nur bei Google liegt, wird sie dort im Filter ergänzt, nicht durch ein weiteres offenes Repository.

## Gradle Wrapper aktualisieren

```bash
./gradlew wrapper --gradle-version <version> \
  --gradle-distribution-sha256-sum <sha256 von https://services.gradle.org/distributions/gradle-<version>-bin.zip.sha256>
```

Danach `./gradlew wrapper` ein zweites Mal ausführen, damit auch `gradle-wrapper.jar` aus der neuen Version stammt.
