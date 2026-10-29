package de.wikifordummys.app.core.storage

/** Einfacher Speicher für Zeichenketten. Speichert, was er bekommt; verschlüsseln muss der Aufrufer. */
interface KeyValueStore {
    suspend fun get(key: String): String?

    suspend fun put(key: String, value: String)

    suspend fun remove(key: String)
}
