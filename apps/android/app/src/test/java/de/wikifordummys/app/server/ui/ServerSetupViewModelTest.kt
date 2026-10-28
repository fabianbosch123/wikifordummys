package de.wikifordummys.app.server.ui

import app.cash.turbine.test
import de.wikifordummys.app.server.data.ServerSettingsRepository
import de.wikifordummys.app.server.model.ServerCheckResult
import de.wikifordummys.app.server.model.ServerChecker
import de.wikifordummys.app.server.model.UrlError
import de.wikifordummys.app.testing.MainDispatcherRule
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ServerSetupViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private class FakeSettings(initial: String? = null) : ServerSettingsRepository {
        val stored = MutableStateFlow(initial)
        var failOnSave = false
        override val serverUrl: Flow<String?> = stored
        override suspend fun saveServerUrl(baseUrl: String) {
            if (failOnSave) throw IOException("disk full")
            stored.value = baseUrl
        }
    }

    private class FakeChecker(var result: ServerCheckResult = ServerCheckResult.Ok) : ServerChecker {
        val checked = mutableListOf<String>()
        var gate: CompletableDeferred<Unit>? = null
        override suspend fun check(baseUrl: String): ServerCheckResult {
            checked += baseUrl
            gate?.await()
            return result
        }
    }

    @Test
    fun `prefills the stored address`() = runTest {
        val viewModel = ServerSetupViewModel(FakeSettings("https://wiki.example.de"), FakeChecker())

        val state = viewModel.uiState.value
        assertEquals("https://wiki.example.de", state.input)
        assertFalse(state.isLoading)
        assertTrue(state.canSubmit)
    }

    @Test
    fun `starts empty without stored address`() = runTest {
        val viewModel = ServerSetupViewModel(FakeSettings(), FakeChecker())

        assertEquals("", viewModel.uiState.value.input)
        assertFalse(viewModel.uiState.value.isLoading)
    }

    @Test
    fun `invalid input shows error and does not call the server`() = runTest {
        val checker = FakeChecker()
        val viewModel = ServerSetupViewModel(FakeSettings(), checker)

        viewModel.onInputChange("http://wiki.example.de")
        viewModel.onSubmit()

        assertEquals(ServerSetupError.Input(UrlError.NotHttps), viewModel.uiState.value.error)
        assertTrue(checker.checked.isEmpty())
    }

    @Test
    fun `typing clears the error`() = runTest {
        val viewModel = ServerSetupViewModel(FakeSettings(), FakeChecker())
        viewModel.onSubmit()
        assertEquals(ServerSetupError.Input(UrlError.Empty), viewModel.uiState.value.error)

        viewModel.onInputChange("w")

        assertNull(viewModel.uiState.value.error)
    }

    @Test
    fun `valid address is checked, saved and reported for navigation`() = runTest {
        val settings = FakeSettings()
        val checker = FakeChecker().apply { gate = CompletableDeferred() }
        val viewModel = ServerSetupViewModel(settings, checker)

        viewModel.uiState.test {
            assertFalse(awaitItem().isChecking)

            viewModel.onInputChange("Wiki.Example.de")
            assertEquals("Wiki.Example.de", awaitItem().input)

            viewModel.onSubmit()
            val checking = awaitItem()
            assertTrue(checking.isChecking)
            assertFalse(checking.canSubmit)
            assertEquals("https://wiki.example.de", checking.input)

            checker.gate!!.complete(Unit)
            val done = awaitItem()
            assertFalse(done.isChecking)
            assertNull(done.error)
            assertEquals("https://wiki.example.de", done.savedBaseUrl)

            viewModel.onNavigated()
            assertNull(awaitItem().savedBaseUrl)
        }
        assertEquals(listOf("https://wiki.example.de"), checker.checked)
        assertEquals("https://wiki.example.de", settings.stored.value)
    }

    @Test
    fun `second submit while checking is ignored`() = runTest {
        val checker = FakeChecker().apply { gate = CompletableDeferred() }
        val viewModel = ServerSetupViewModel(FakeSettings(), checker)

        viewModel.onInputChange("https://wiki.example.de")
        viewModel.onSubmit()
        viewModel.onSubmit()
        checker.gate!!.complete(Unit)

        assertEquals(1, checker.checked.size)
    }

    @Test
    fun `server problems are mapped to errors and nothing is saved`() = runTest {
        val cases = mapOf(
            ServerCheckResult.Unreachable to ServerSetupError.Unreachable,
            ServerCheckResult.TlsError to ServerSetupError.Tls,
            ServerCheckResult.NotAWiki to ServerSetupError.NotAWiki,
            ServerCheckResult.Unhealthy to ServerSetupError.Unhealthy,
            ServerCheckResult.RateLimited to ServerSetupError.RateLimited,
            ServerCheckResult.HttpError(500) to ServerSetupError.Http(500),
        )
        for ((result, expected) in cases) {
            val settings = FakeSettings()
            val viewModel = ServerSetupViewModel(settings, FakeChecker(result))

            viewModel.onInputChange("https://wiki.example.de")
            viewModel.onSubmit()

            val state = viewModel.uiState.value
            assertEquals(expected, state.error)
            assertFalse(state.isChecking)
            assertNull(state.savedBaseUrl)
            assertNull(settings.stored.value)
        }
    }

    @Test
    fun `failed save shows error`() = runTest {
        val settings = FakeSettings().apply { failOnSave = true }
        val viewModel = ServerSetupViewModel(settings, FakeChecker())

        viewModel.onInputChange("https://wiki.example.de")
        viewModel.onSubmit()

        assertEquals(ServerSetupError.SaveFailed, viewModel.uiState.value.error)
        assertNull(viewModel.uiState.value.savedBaseUrl)
    }
}
