package de.wikifordummys.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import de.wikifordummys.app.navigation.WikiNavHost
import de.wikifordummys.app.ui.theme.WikiTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            WikiTheme {
                WikiNavHost()
            }
        }
    }
}
