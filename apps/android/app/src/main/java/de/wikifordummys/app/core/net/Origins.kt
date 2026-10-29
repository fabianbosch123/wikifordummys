package de.wikifordummys.app.core.net

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Gleicher Ursprung (Schema, Host, Port) wie die gespeicherte Basis-Adresse des Wikis. */
fun HttpUrl.hasSameOriginAs(baseUrl: String): Boolean {
    val base = baseUrl.toHttpUrlOrNull() ?: return false
    return scheme == base.scheme && host == base.host && port == base.port
}
