package de.wikifordummys.app.core.net

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Response

/**
 * Führt einen Aufruf synchron auf [dispatcher] aus und verarbeitet die Antwort dort.
 *
 * Bewusst nicht über `enqueue`: Die Token-Erneuerung läuft auch aus dem [okhttp3.Authenticator] heraus, also auf einem
 * Thread des OkHttp-Dispatchers. Ein zweiter asynchroner Aufruf an denselben Host könnte dort auf einen freien Platz
 * warten, den die wartenden Aufrufe selbst belegen.
 */
internal suspend fun <T> Call.executeOn(dispatcher: CoroutineDispatcher, block: (Response) -> T): T =
    withContext(dispatcher) { execute().use(block) }
