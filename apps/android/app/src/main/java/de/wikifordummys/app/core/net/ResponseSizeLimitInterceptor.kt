package de.wikifordummys.app.core.net

import java.io.IOException
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.Source
import okio.buffer

/** Wird geworfen, sobald eine Antwort größer ist als erlaubt. Ist eine [IOException], damit Aufrufer sie wie Netzfehler behandeln. */
class ResponseTooLargeException(val limitBytes: Long) : IOException("Antwort größer als $limitBytes Bytes")

/** Grenze für eine einzelne Anfrage, als Tag an der [okhttp3.Request] (überschreibt die Standardgrenze). */
data class ResponseSizeLimit(val maxBytes: Long)

/**
 * Begrenzt jede Antwort (auch Fehlerantworten) auf eine Größe. Eine zu große `Content-Length` wird gar nicht erst
 * gelesen; ohne oder mit falscher Längenangabe bricht das Lesen ab, sobald die Grenze überschritten ist. So kann ein
 * fremder oder kaputter Server die App nicht mit einer riesigen Antwort volllaufen lassen.
 */
class ResponseSizeLimitInterceptor(private val defaultLimitBytes: Long = DEFAULT_LIMIT_BYTES) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val limit = request.tag(ResponseSizeLimit::class.java)?.maxBytes ?: defaultLimitBytes
        val response = chain.proceed(request)
        val body = response.body
        if (body.contentLength() > limit) {
            response.close()
            throw ResponseTooLargeException(limit)
        }
        return response.newBuilder().body(LimitedResponseBody(body, limit)).build()
    }

    companion object {
        /** Reicht für JSON der REST-API; Anhänge bekommen später eine eigene Grenze per [ResponseSizeLimit]. */
        const val DEFAULT_LIMIT_BYTES = 2L * 1024 * 1024
    }
}

private class LimitedResponseBody(
    private val delegate: ResponseBody,
    private val limit: Long,
) : ResponseBody() {
    private val limited: BufferedSource by lazy { LimitedSource(delegate.source(), limit).buffer() }

    override fun contentType(): MediaType? = delegate.contentType()

    override fun contentLength(): Long = delegate.contentLength()

    override fun source(): BufferedSource = limited
}

private class LimitedSource(delegate: Source, private val limit: Long) : ForwardingSource(delegate) {
    private var total = 0L

    override fun read(sink: Buffer, byteCount: Long): Long {
        // Höchstens ein Byte über die Grenze anfordern, damit nie viel mehr als erlaubt im Speicher landet.
        val read = super.read(sink, minOf(byteCount, limit - total + 1))
        if (read > 0) {
            total += read
            if (total > limit) throw ResponseTooLargeException(limit)
        }
        return read
    }
}
