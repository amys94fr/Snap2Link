package com.snap2link.app

import androidx.core.content.edit
import android.app.Application
import android.content.Context
import com.snap2link.app.relay.Hosting
import com.snap2link.app.relay.RelayClient
import com.snap2link.app.relay.TokenStore

class Snap2LinkApp : Application() {
    val client by lazy { RelayClient() }
    val hosting by lazy { Hosting(client, PreferenceTokens(this)) }
}

val Context.hosting: Hosting get() = (applicationContext as Snap2LinkApp).hosting

/**
 * The tokens stay in the app's private storage, which backups leave out (see
 * `data_extraction_rules.xml`), as the desktop app keeps them in its own folder.
 */
private class PreferenceTokens(context: Context) : TokenStore {
    private val prefs = context.getSharedPreferences("hosting", Context.MODE_PRIVATE)

    override var guest: String?
        get() = prefs.getString("guest", null)
        set(value) = prefs.edit { putString("guest", value) }

    override var session: String?
        get() = prefs.getString("session", null)
        set(value) = prefs.edit { putString("session", value) }

    override var email: String?
        get() = prefs.getString("email", null)
        set(value) = prefs.edit { putString("email", value) }
}
