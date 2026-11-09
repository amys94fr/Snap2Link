package com.snap2link.app.drive

import com.snap2link.app.relay.Link
import java.time.Duration
import java.time.Instant

/** What Drive hosting remembers between runs. */
interface DriveStore {
    var email: String?
    var folder: String?
    var autoDelete: Boolean
    var retentionDays: Int
    var lastCleanup: Long
}

/**
 * Drive hosting with the desktop's rules: one "Snap2Link" folder, public
 * links, and an automatic cleanup that leaves kept captures alone.
 */
class DriveHosting(private val client: DriveClient, private val store: DriveStore) {
    val connected: Boolean get() = store.email != null
    val email: String? get() = store.email
    val folder: String? get() = store.folder
    val autoDelete: Boolean get() = store.autoDelete
    val retentionDays: Int get() = store.retentionDays

    /** Asks for the permission, then finds the account's address and folder. */
    suspend fun connect(auth: DriveAuth) {
        withToken(auth) { token ->
            val email = client.email(token)
            store.folder = client.folder(token, null)
            store.email = email
        }
    }

    /** Signs out of Drive here and withdraws the app's access. */
    suspend fun disconnect(auth: DriveAuth) {
        store.email?.let { auth.revoke(it) }
        store.email = null
        store.folder = null
    }

    suspend fun upload(auth: DriveAuth, png: ByteArray): Link {
        requireConnected()
        return withToken(auth) { token -> client.upload(token, folder(token), png) }
    }

    suspend fun history(auth: DriveAuth): List<Link> {
        requireConnected()
        val days = store.retentionDays.takeIf { store.autoDelete }
        return withToken(auth) { token -> client.history(token, folder(token), days) }
    }

    suspend fun setKept(auth: DriveAuth, id: String, kept: Boolean) {
        withToken(auth) { token -> client.setKept(token, id, kept) }
    }

    suspend fun delete(auth: DriveAuth, id: String) {
        withToken(auth) { token -> client.delete(token, id) }
    }

    /** Runs the cleanup at most every 12 hours; `true` when it ran. */
    suspend fun cleanupIfDue(auth: DriveAuth, now: Instant = Instant.now()): Boolean {
        if (!connected || !store.autoDelete) return false
        if (now.toEpochMilli() - store.lastCleanup < CLEANUP_EVERY.toMillis()) return false
        withToken(auth) { token -> client.cleanup(token, folder(token), store.retentionDays, now) }
        store.lastCleanup = now.toEpochMilli()
        return true
    }

    fun setRetention(autoDelete: Boolean, days: Int) {
        store.autoDelete = autoDelete
        store.retentionDays = days.coerceIn(MIN_DAYS, MAX_DAYS)
    }

    private fun requireConnected() {
        if (!connected) throw DriveException(PlayDriveAuth.NOT_CONNECTED)
    }

    /** The folder, created again when it went to the trash. */
    private suspend fun folder(token: String): String =
        client.folder(token, store.folder).also { store.folder = it }

    /** Runs [call] with a token, and once more with a new one when Drive refuses it. */
    private suspend fun <T> withToken(auth: DriveAuth, call: suspend (String) -> T): T {
        val token = auth.token()
        return try {
            call(token)
        } catch (e: DriveException) {
            if (e.code != DriveClient.UNAUTHORIZED) throw e
            auth.clear(token)
            call(auth.token())
        }
    }

    companion object {
        const val DEFAULT_DAYS = 30
        const val MIN_DAYS = 1
        const val MAX_DAYS = 3650
        private val CLEANUP_EVERY: Duration = Duration.ofHours(12)
    }
}
