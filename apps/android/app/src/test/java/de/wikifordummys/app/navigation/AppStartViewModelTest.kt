package de.wikifordummys.app.navigation

import app.cash.turbine.test
import de.wikifordummys.app.auth.model.SessionInfo
import de.wikifordummys.app.server.data.ServerSettingsRepository
import de.wikifordummys.app.testing.FakeAuthRepository
import de.wikifordummys.app.testing.MainDispatcherRule
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AppStartViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private class FakeSettings(initial: String?) : ServerSettingsRepository {
        override val serverUrl = MutableStateFlow(initial)
        override suspend fun saveServerUrl(baseUrl: String) {
            serverUrl.value = baseUrl
        }
    }

    private val wiki = "https://wiki.example.de"

    @Test
    fun `decision from stored address and session`() {
        assertEquals(StartState.NeedsServer, StartState.of(null, null))
        assertEquals(StartState.NeedsServer, StartState.of(null, SessionInfo(wiki)))
        assertEquals(StartState.NeedsLogin(wiki), StartState.of(wiki, null))
        assertEquals(StartState.LoggedIn(wiki), StartState.of(wiki, SessionInfo(wiki)))
        // Tokens eines anderen Wikis zählen nicht
        assertEquals(StartState.NeedsLogin(wiki), StartState.of(wiki, SessionInfo("https://other.example")))
    }

    @Test
    fun `follows login, logout and lost consent`() = runTest {
        val auth = FakeAuthRepository()
        val vm = AppStartViewModel(FakeSettings(wiki), auth)
        vm.state.test {
            assertEquals(StartState.NeedsLogin(wiki), awaitItem())
            auth.session.value = SessionInfo(wiki)
            assertEquals(StartState.LoggedIn(wiki), awaitItem())
            auth.session.value = null
            assertEquals(StartState.NeedsLogin(wiki), awaitItem())
        }
    }

    @Test
    fun `without address the server setup comes first`() = runTest {
        val settings = FakeSettings(null)
        val vm = AppStartViewModel(settings, FakeAuthRepository())
        assertEquals(StartState.NeedsServer, vm.state.value)
        settings.saveServerUrl(wiki)
        assertEquals(StartState.NeedsLogin(wiki), vm.state.value)
    }
}
