// Gruppen, die nur bei Google Maven liegen, werden ausschließlich dort gesucht; alles andere (auch Guava, Gson,
// Protobuf und andere com.google.*-Gruppen) kommt ausschließlich aus Maven Central. Das Plugin Portal wird nicht
// gebraucht: Die Kotlin-Plugins liegen mit ihren Markern in Maven Central, AGP bei Google.
pluginManagement {
    repositories {
        exclusiveContent {
            forRepository { google() }
            filter {
                includeGroupByRegex("androidx\\..*")
                includeGroupByRegex("com\\.android(\\..*)?")
                includeGroupByRegex("com\\.google\\.android\\..*")
                includeGroup("com.google.testing.platform")
                includeGroup("com.google.prefab")
            }
        }
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        exclusiveContent {
            forRepository { google() }
            filter {
                includeGroupByRegex("androidx\\..*")
                includeGroupByRegex("com\\.android(\\..*)?")
                includeGroupByRegex("com\\.google\\.android\\..*")
                includeGroup("com.google.testing.platform")
                includeGroup("com.google.prefab")
            }
        }
        mavenCentral()
    }
}

rootProject.name = "wikifordummys-android"
include(":app")
