package de.wikifordummys.app.core.net

import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/** Gemeinsame Grundeinstellung aller HTTP-Clients der App. */
object HttpClients {
    /**
     * Client ohne Zugangsdaten. Bewusst ohne Logging-Interceptor, damit keine Tokens in Logs landen. Jede Antwort, auch
     * eine Fehlerantwort, ist über [ResponseSizeLimitInterceptor] größenbegrenzt; Clients für einzelne Zwecke leiten
     * sich mit `newBuilder()` hiervon ab und behalten die Grenze.
     */
    fun base(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .addInterceptor(ResponseSizeLimitInterceptor())
        .build()

    /** Sorgt dafür, dass ein abgeleiteter Client die Größengrenze hat, auch wenn der Basis-Client sie nicht mitbringt. */
    fun OkHttpClient.Builder.ensureSizeLimit(): OkHttpClient.Builder = apply {
        if (interceptors().none { it is ResponseSizeLimitInterceptor }) {
            interceptors().add(0, ResponseSizeLimitInterceptor())
        }
    }
}
