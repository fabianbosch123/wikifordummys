package de.wikifordummys.app.auth.ui

import de.wikifordummys.app.auth.data.OAuthCallbackInbox
import de.wikifordummys.app.auth.model.LoginResult
import de.wikifordummys.app.auth.model.SessionInfo
import de.wikifordummys.app.testing.FakeAuthRepository
import de.wikifordummys.app.testing.MainDispatcherRule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class LoginViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val baseUrl = "https://wiki.example.de"
    private val auth = FakeAuthRepository()
    private val inbox = OAuthCallbackInbox()
    private val callback = "de.wikifordummys.app:/oauth/callback?state=s&iss=x&code=c"

    private fun viewModel() = LoginViewModel(baseUrl, auth, inbox)

    @Test
    fun `login click opens the browser once`() = runTest {
        val vm = viewModel()
        vm.onLoginClick()

        assertEquals(listOf(baseUrl), auth.begun)
        val state = vm.uiState.value
        assertEquals(LoginPhase.WaitingForBrowser, state.phase)
        assertEquals("$baseUrl/oauth/authorize?state=s", state.browserUrl)

        vm.onBrowserOpened()
        assertNull(vm.uiState.value.browserUrl)
        assertTrue(vm.uiState.value.canStart)
    }

    @Test
    fun `missing browser and storage problems are shown`() = runTest {
        val vm = viewModel()
        vm.onLoginClick()
        vm.onBrowserUnavailable()
        assertEquals(LoginError.NoBrowser, vm.uiState.value.error)
        assertEquals(LoginPhase.Idle, vm.uiState.value.phase)

        auth.failBegin = true
        vm.onLoginClick()
        assertEquals(LoginError.StorageFailed, vm.uiState.value.error)
        assertNull(vm.uiState.value.browserUrl)
    }

    @Test
    fun `callback is consumed once and completes the login for this wiki`() = runTest {
        val vm = viewModel()
        vm.onLoginClick()
        vm.onBrowserOpened()

        inbox.deliver(callback)

        assertEquals(listOf(baseUrl to callback), auth.completed)
        assertEquals(LoginPhase.Done, vm.uiState.value.phase)
        assertNull(inbox.pending.value)
        assertEquals(SessionInfo(baseUrl), auth.session.value)
    }

    @Test
    fun `callback that arrived before the screen existed is handled (process death)`() = runTest {
        inbox.deliver(callback)
        val vm = viewModel()
        assertEquals(1, auth.completed.size)
        assertEquals(LoginPhase.Done, vm.uiState.value.phase)
    }

    @Test
    fun `foreign or stale callbacks are dropped silently`() = runTest {
        val vm = viewModel()
        vm.onLoginClick()
        vm.onBrowserOpened()
        auth.result = LoginResult.Rejected
        inbox.deliver(callback)

        assertEquals(LoginPhase.WaitingForBrowser, vm.uiState.value.phase)
        assertNull(vm.uiState.value.error)

        auth.result = LoginResult.NoPendingLogin
        inbox.deliver(callback + "&x=1")
        assertEquals(LoginPhase.WaitingForBrowser, vm.uiState.value.phase)
    }

    @Test
    fun `errors from the callback are mapped`() = runTest {
        val cases = mapOf(
            LoginResult.AccessDenied to LoginError.AccessDenied,
            LoginResult.IssuerMismatch to LoginError.IssuerMismatch,
            LoginResult.InvalidGrant to LoginError.InvalidGrant,
            LoginResult.Network to LoginError.Network,
            LoginResult.Http(500) to LoginError.Server,
            LoginResult.StorageFailed to LoginError.StorageFailed,
        )
        val vm = viewModel()
        cases.entries.forEachIndexed { i, (result, error) ->
            auth.result = result
            inbox.deliver("$callback&n=$i")
            assertEquals(error, vm.uiState.value.error)
            assertEquals(LoginPhase.Idle, vm.uiState.value.phase)
        }
    }

    @Test
    fun `no second exchange or browser start while exchanging`() = runTest {
        val vm = viewModel()
        auth.gate = CompletableDeferred()
        inbox.deliver(callback)
        assertEquals(LoginPhase.Exchanging, vm.uiState.value.phase)
        assertFalse(vm.uiState.value.canStart)

        vm.onLoginClick()
        assertTrue(auth.begun.isEmpty())

        auth.gate!!.complete(Unit)
        assertEquals(LoginPhase.Done, vm.uiState.value.phase)
    }
}
