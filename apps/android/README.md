# wikifordummys für Android

Android-Client für wikifordummys: Kotlin, Jetpack Compose, Material 3 (dynamische Farben ab Android 12, hell und dunkel),
Navigation Compose. Das Projekt ist kein Teil des pnpm-Workspace (deshalb gibt es hier keine `package.json`).

**Stand:** Adresse und Anmeldung. Die App fragt beim Start nach der Adresse des Wikis, lässt nur `https://` zu, prüft die
Adresse über `GET /api/v1/health` und speichert sie in einem DataStore. Danach meldet sie sich per OAuth 2.1 mit PKCE
im Browser an und zeigt die Spaces des Benutzers (nur lesend).

## Anmeldung

Ablauf (Server: `apps/api/src/oauth`, fester Client `APP_OAUTH_CLIENT_ID` und `APP_OAUTH_REDIRECT_URI` aus
`packages/shared/src/index.ts`, in der App `auth/model/AppOAuth.kt`):

1. „Im Browser anmelden“ erzeugt einen PKCE-Verifier (32 Bytes aus `SecureRandom`, base64url) und einen zufälligen
   `state` und speichert beide verschlüsselt, damit sie einen Prozesstod überleben. Sie gelten für genau einen
   Rücksprung und höchstens 30 Minuten.
2. Der Browser öffnet `<wiki>/oauth/authorize?response_type=code&client_id=…&redirect_uri=de.wikifordummys.app:/oauth/callback&code_challenge=…&code_challenge_method=S256&state=…&resource=<wiki>/api/v1`,
   als Custom Tab (androidx.browser), ohne Custom-Tabs-fähigen Browser über `ACTION_VIEW`. Dort meldet sich der
   Benutzer mit Passwort und 2FA-Code an und stimmt zu (für die App höchstens 30 Tage, nur lesend).
3. Der Rücksprung `de.wikifordummys.app:/oauth/callback?state=…&iss=…&code=…` landet in `OAuthCallbackActivity`
   (ohne Oberfläche). Geprüft werden: laufende Anmeldung für dieses Wiki, `state` (konstantzeitig), `iss` gleich der
   Wiki-Adresse, `error`. Rücksprünge ohne laufende Anmeldung oder mit falschem `state` werden verworfen.
4. Tausch des Codes über `POST /api/v1/oauth/token` (Formular, `grant_type=authorization_code`, `code_verifier`,
   `resource`). Das Access-Token (`wfd_…`, 1 h) geht als Bearer an die REST-API, das Refresh-Token (`wfr_…`) wird bei
   jeder Erneuerung ausgetauscht.
5. Antwortet die API mit 401, erneuert `TokenAuthenticator` genau einmal und wiederholt die Anfrage einmal. Parallele
   401 teilen sich eine Erneuerung (Mutex), ein altes Refresh-Token wird nie erneut vorgelegt. Bei `invalid_grant`
   löscht die App die Tokens und zeigt wieder die Anmeldung.
6. „Abmelden“ widerruft die Zustimmung über `POST /api/v1/oauth/revoke` und löscht die Tokens lokal, auch wenn der
   Widerruf scheitert.

App-Tokens gelten am Server nur für GET auf Spaces, Seiten, Suche, Anhänge und `GET /me`; 403 heißt „für die App nicht
freigegeben“.

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
./gradlew testDebugUnitTest      # Unit-Tests (JVM, ohne Gerät; MockWebServer für Token-Endpunkt und API)
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
  auth/model/      PKCE, Rücksprung-Parser, OAuth-Konstanten, Ergebnisse
  auth/data/       Token-Endpunkt, Repository (Anmeldung, Erneuerung, Abmeldung), Bearer-Interceptor, Authenticator,
                   verschlüsselte Speicher für Sitzung und laufende Anmeldung
  auth/ui/         Bildschirm „Anmelden“, Öffnen des Browsers (Custom Tab oder ACTION_VIEW)
  auth/OAuthCallbackActivity.kt   nimmt den Rücksprung aus dem Browser an
  core/net/        gemeinsamer OkHttp-Client, Größengrenze für Antworten, Origin-Vergleich
  core/security/   AES-GCM (TokenCipher) mit Schlüssel aus dem Android Keystore
  core/storage/    verschlüsselte Werte in einem Preferences-DataStore
  core/api/        Zuordnung von HTTP-Status und Fehlern der REST-API
  home/            Startbildschirm nach der Anmeldung: „Angemeldet als …“, Spaces, Abmelden
  navigation/      Start nach gespeicherter Adresse und Sitzung (AppStartViewModel)
```

Texte stehen in `app/src/main/res/values/strings.xml` (Deutsch als Standard).

## Sicherheit

- Nur HTTPS: `usesCleartextTraffic="false"` und `res/xml/network_security_config.xml` ohne Ausnahmen; die App vertraut nur den
  Zertifizierungsstellen des Systems. Ein Wiki in der Betriebsart `internal` (eigene Zertifizierungsstelle von Caddy) ist deshalb aus der
  App heraus noch nicht erreichbar.
- Kein Backup: `allowBackup="false"` und Regeln, die alle Daten von Cloud-Backup und Geräteübertragung ausschließen.
- Der Health-Check folgt keinen Weiterleitungen und sendet keine Zugangsdaten. Es gibt keinen Logging-Interceptor.
- Jede Antwort, auch eine Fehlerantwort, ist über einen gemeinsamen Interceptor (`ResponseSizeLimitInterceptor`)
  größenbegrenzt: 2 MiB für die REST-API, 16 KiB am Token-Endpunkt.
- Tokens und die laufende Anmeldung liegen nur verschlüsselt im DataStore `auth` (AES-256-GCM, Schlüssel im Android
  Keystore, nicht exportierbar; der Name des Eintrags ist zusätzliche authentisierte Daten). Sie werden nie geloggt;
  `toString()` der Modelle verbirgt sie.
- Der Bearer geht nur an die gespeicherte Wiki-Origin (Schema, Host, Port), ein von außen gesetzter
  `Authorization`-Header wird entfernt. Token-Endpunkt und API-Client folgen keinen Weiterleitungen.
- Der Rücksprung nutzt ein privates Schema (`de.wikifordummys.app:`). Das kann auch eine fremde App beanspruchen
  (RFC 8252, 8.6); dagegen schützen PKCE, `state`, `iss` und die kurze Zustimmung (30 Tage). Android wertet im
  Intent-Filter Pfade ohne Host nicht aus, deshalb prüft die App Schema, Pfad und Parameter selbst.
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
