package com.snap2link.app

import androidx.core.content.edit
import android.app.Application
import android.content.Context
import com.snap2link.app.detect.ScreenshotWatch
import com.snap2link.app.drive.DriveClient
import com.snap2link.app.drive.DriveHosting
import com.snap2link.app.drive.DriveStore
import com.snap2link.app.relay.Hosting
import com.snap2link.app.relay.RelayClient
import com.snap2link.app.relay.TokenStore
import com.snap2link.app.ui.AppLanguage

class Snap2LinkApp : Application() {
    val client by lazy { RelayClient() }
    val hosting by lazy { Hosting(client, PreferenceTokens(this)) }
    val drive by lazy { DriveHosting(DriveClient(), PreferenceDrive(this)) }

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(AppLanguage.wrap(base))
    }

    override fun onCreate() {
        super.onCreate()
        // A watch Android dropped (the app was stopped) starts again.
        ScreenshotWatch.refresh(this)
    }
}

val Context.hosting: Hosting get() = (applicationContext as Snap2LinkApp).hosting
val Context.drive: DriveHosting get() = (applicationContext as Snap2LinkApp).drive

/** Where captures go. Snap2Link hosting unless the person picked Google Drive. */
enum class Host { SNAP2LINK, DRIVE }

var Context.host: Host
    get() = if (settings.getString("hosting", null) == "drive") Host.DRIVE else Host.SNAP2LINK
    set(value) = settings.edit { putString("hosting", if (value == Host.DRIVE) "drive" else "snap2link") }

private val Context.settings get() = applicationContext.getSharedPreferences("settings", Context.MODE_PRIVATE)

/** Drive's account and folder; the Google token itself stays with Play services. */
private class PreferenceDrive(context: Context) : DriveStore {
    private val prefs = context.getSharedPreferences("drive", Context.MODE_PRIVATE)

    override var email: String?
        get() = prefs.getString("email", null)
        set(value) = prefs.edit { putString("email", value) }

    override var folder: String?
        get() = prefs.getString("folder", null)
        set(value) = prefs.edit { putString("folder", value) }

    override var autoDelete: Boolean
        get() = prefs.getBoolean("auto_delete", true)
        set(value) = prefs.edit { putBoolean("auto_delete", value) }

    override var retentionDays: Int
        get() = prefs.getInt("retention_days", DriveHosting.DEFAULT_DAYS)
        set(value) = prefs.edit { putInt("retention_days", value) }

    override var lastCleanup: Long
        get() = prefs.getLong("last_cleanup", 0)
        set(value) = prefs.edit { putLong("last_cleanup", value) }
}

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
