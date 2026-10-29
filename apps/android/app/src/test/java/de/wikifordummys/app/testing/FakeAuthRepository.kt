package de.wikifordummys.app.testing

import de.wikifordummys.app.auth.data.AuthRepository
import de.wikifordummys.app.auth.model.LoginResult
import de.wikifordummys.app.auth.model.SessionInfo
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow

class FakeAuthRepository(initial: SessionInfo? = null) : AuthRepository {
    override val session = MutableStateFlow(initial)
    var failBegin = false
    var result: LoginResult = LoginResult.Success
    var gate: CompletableDeferred<Unit>? = null
    val begun = mutableListOf<String>()
    val completed = mutableListOf<Pair<String, String>>()
    var logouts = 0

    override suspend fun beginLogin(baseUrl: String): String {
        if (failBegin) throw IOException("keystore")
        begun += baseUrl
        return "$baseUrl/oauth/authorize?state=s"
    }

    override suspend fun completeLogin(baseUrl: String, rawCallback: String): LoginResult {
        completed += baseUrl to rawCallback
        gate?.await()
        if (result == LoginResult.Success) session.value = SessionInfo(baseUrl)
        return result
    }

    override suspend fun logout() {
        logouts++
        gate?.await()
        session.value = null
    }
}
