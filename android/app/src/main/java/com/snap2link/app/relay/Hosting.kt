package com.snap2link.app.relay

/** Where the tokens live between launches. */
interface TokenStore {
    var guest: String?
    var session: String?
    var email: String?
}

/**
 * Snap2Link hosting as the app uses it: the session when signed in, the guest
 * token otherwise, as the desktop app does in `upload.rs`.
 *
 * A call that needs a guest token and has none throws `guest_required`: the
 * screen then runs the security check and calls [rememberGuest].
 */
class Hosting(private val client: RelayClient, private val store: TokenStore) {
    val signedIn: Boolean get() = store.session != null
    val email: String? get() = store.email.takeIf { signedIn }
    val hasToken: Boolean get() = store.session != null || store.guest != null

    suspend fun rememberGuest(turnstile: String) {
        store.guest = client.createGuest(turnstile)
    }

    /** Sends with the account when signed in, and as a guest otherwise. */
    suspend fun upload(png: ByteArray): Created {
        store.session?.let { session ->
            try {
                return client.upload(session, png)
            } catch (e: RelayException) {
                if (e.code != RelayClient.SESSION_REQUIRED) throw e
                forgetSession()
            }
        }
        return asGuest { client.upload(it, png) }
    }

    suspend fun history(): Links? {
        val token = store.session ?: store.guest ?: return null
        return withSession { client.history(token) }
    }

    suspend fun setPinned(id: String, pinned: Boolean) {
        val session = store.session ?: throw RelayException(RelayClient.SESSION_REQUIRED)
        withSession { client.setPinned(session, id, pinned) }
    }

    suspend fun delete(id: String) {
        val token = store.session ?: store.guest ?: throw RelayException(RelayClient.GUEST_REQUIRED)
        withSession { client.delete(token, id) }
    }

    suspend fun requestCode(email: String, language: String) {
        asGuest { client.requestCode(it, email, language) }
    }

    suspend fun verifyCode(email: String, code: String) {
        val session = asGuest { client.verifyCode(it, email, code) }
        store.session = session.token
        store.email = session.email
    }

    suspend fun signInWithGoogle(idToken: String) {
        val session = asGuest { client.signInWithGoogle(it, idToken) }
        store.session = session.token
        store.email = session.email
    }

    suspend fun account(): AccountStatus? {
        val session = store.session ?: return null
        return withSession { client.account(session) }
    }

    suspend fun signOut() {
        val session = store.session ?: return
        try {
            client.signOut(session)
        } catch (e: RelayException) {
            // Signing out works offline too: the session is forgotten either way.
            if (e.code != RelayClient.UNREACHABLE && e.code != RelayClient.SESSION_REQUIRED) throw e
        }
        forgetSession()
    }

    suspend fun deleteAccount() {
        val session = store.session ?: return
        client.deleteAccount(session)
        forgetSession()
    }

    private fun forgetSession() {
        store.session = null
        store.email = null
    }

    /** Runs [call] with the guest token, and forgets a token the relay refuses. */
    private suspend fun <T> asGuest(call: suspend (String) -> T): T {
        val guest = store.guest ?: throw RelayException(RelayClient.GUEST_REQUIRED)
        try {
            return call(guest)
        } catch (e: RelayException) {
            if (e.code == RelayClient.GUEST_REQUIRED) store.guest = null
            throw e
        }
    }

    /** Runs [call], and forgets a session the relay refuses. */
    private suspend fun <T> withSession(call: suspend () -> T): T {
        try {
            return call()
        } catch (e: RelayException) {
            when (e.code) {
                RelayClient.SESSION_REQUIRED -> forgetSession()
                RelayClient.GUEST_REQUIRED -> store.guest = null
            }
            throw e
        }
    }
}
