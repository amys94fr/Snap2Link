package com.snap2link.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.snap2link.app.account.AccountScreen
import com.snap2link.app.history.HistoryScreen
import com.snap2link.app.home.HomeScreen
import com.snap2link.app.ui.AppLanguage
import com.snap2link.app.ui.Snap2LinkTheme

class MainActivity : ComponentActivity() {
    private var tab by mutableStateOf(TAB_SEND)

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLanguage.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        tab = savedInstanceState?.getString(EXTRA_TAB) ?: tabOf(intent) ?: TAB_SEND
        setContent {
            Snap2LinkTheme {
                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            TABS.forEach { (id, label, icon) ->
                                NavigationBarItem(
                                    selected = tab == id,
                                    onClick = { tab = id },
                                    icon = { Icon(painterResource(icon), contentDescription = null) },
                                    label = { Text(stringResource(label)) },
                                )
                            }
                        }
                    },
                ) { padding ->
                    val modifier = Modifier.padding(padding)
                    when (tab) {
                        TAB_HISTORY -> HistoryScreen(modifier)
                        TAB_ACCOUNT -> AccountScreen(modifier)
                        else -> HomeScreen(modifier, onSignUp = { tab = TAB_ACCOUNT })
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        tabOf(intent)?.let { tab = it }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(EXTRA_TAB, tab)
    }

    private fun tabOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_TAB)?.takeIf { it in TAB_IDS }

    companion object {
        const val EXTRA_TAB = "tab"
        const val TAB_SEND = "send"
        const val TAB_HISTORY = "history"
        const val TAB_ACCOUNT = "account"

        private val TABS = listOf(
            Triple(TAB_SEND, R.string.tab_send, R.drawable.ic_send),
            Triple(TAB_HISTORY, R.string.tab_history, R.drawable.ic_history),
            Triple(TAB_ACCOUNT, R.string.tab_account, R.drawable.ic_user),
        )
        private val TAB_IDS = TABS.map { it.first }.toSet()
    }
}
