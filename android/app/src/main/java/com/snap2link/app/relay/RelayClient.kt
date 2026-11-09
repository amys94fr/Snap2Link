package com.snap2link.app.relay

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * Client for the Snap2Link relay (see `relay/` at the repository root), the
 * same calls as the desktop app's `src-tauri/src/commands/relay.rs`.
 *
 * Failures come back as a [RelayException] carrying the relay's own error
 * code, such as `daily_limit`, or one of the codes below.
 */
class RelayClient(base: String = DEFAULT_BASE) {
    private val base = base.trimEnd('/')

    /** Turns a passed Turnstile challenge into a guest token. */
    suspend fun createGuest(turnstile: String): String {
        val body = call("POST", "/v1/guests", json = JSONObject().put("turnstile", turnstile))
        return parse(body) { it.getString("guest_token") }
    }

    /** Sends a login code to [email], in [language] when the relay knows it. */
    suspend fun requestCode(guest: String, email: String, language: String) {
        call("POST", "/v1/login/code", guest, JSONObject().put("email", email).put("language", language))
    }

    /** Turns a login code into a session, creating the account the first time. */
    suspend fun verifyCode(guest: String, email: String, code: String): Session {
        val body = call("POST", "/v1/login/verify", guest, JSONObject().put("email", email).put("code", code))
        return parse(body) { Session(it.getString("session_token"), it.getString("email")) }
    }

    /** Turns a Google ID token into a session, creating the account the first time. */
    suspend fun signInWithGoogle(guest: String, idToken: String): Session {
        val body = call("POST", "/v1/login/google", guest, JSONObject().put("id_token", idToken))
        return parse(body) { Session(it.getString("session_token"), it.getString("email")) }
    }

    suspend fun account(session: String): AccountStatus {
        val body = call("GET", "/v1/me", session)
        return parse(body) {
            AccountStatus(
                email = it.getString("email"),
                plan = it.getString("plan"),
                capturesToday = it.getInt("captures_today"),
                dailyCaptures = it.getInt("daily_captures"),
                slotsUsed = it.getInt("slots_used"),
                slots = it.getInt("slots"),
            )
        }
    }

    suspend fun signOut(session: String) {
        call("POST", "/v1/logout", session)
    }

    suspend fun deleteAccount(session: String) {
        call("DELETE", "/v1/me", session)
    }

    /** Sends a PNG with a guest token or a session. */
    suspend fun upload(token: String, png: ByteArray): Created {
        val body = call("POST", "/v1/captures", token, bytes = png, contentType = "image/png")
        val created = parse(body) { Created(it.getString("id"), it.getString("url")) }
        // This link goes to the clipboard and gets shared: it has to be the relay's.
        if (!isOwnLink(created.url)) throw RelayException(INVALID_RESPONSE)
        return created
    }

    /** The links of a guest or a session that still work, newest first. */
    suspend fun history(token: String): Links {
        val body = call("GET", "/v1/captures", token)
        return parse(body) { json ->
            val list = json.getJSONArray("captures")
            val captures = (0 until list.length()).map { i ->
                val link = list.getJSONObject(i)
                Link(
                    id = link.getString("id"),
                    url = link.getString("url"),
                    createdAt = instant(link.getString("created_at")),
                    expiresAt = if (link.isNull("expires_at")) null else instant(link.getString("expires_at")),
                    pinned = link.optBoolean("pinned", false),
                )
            }
            // These links are shown and copied: they have to be the relay's.
            Links(captures.filter { isOwnLink(it.url) && isCaptureId(it.id) }, json.getInt("max_pins"))
        }
    }

    suspend fun setPinned(session: String, id: String, pinned: Boolean) {
        require(isCaptureId(id))
        call(if (pinned) "PUT" else "DELETE", "/v1/captures/$id/pin", session)
    }

    suspend fun delete(token: String, id: String) {
        require(isCaptureId(id))
        call("DELETE", "/v1/captures/$id", token)
    }

    /** Whether [url] is a page of this relay, and not of a look-alike host. */
    fun isOwnLink(url: String): Boolean = url.startsWith("$base/")

    private suspend fun call(
        method: String,
        path: String,
        token: String? = null,
        json: JSONObject? = null,
        bytes: ByteArray? = null,
        contentType: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val connection = try {
            URL(base + path).openConnection() as HttpURLConnection
        } catch (_: IOException) {
            throw RelayException(UNREACHABLE)
        }
        try {
            connection.requestMethod = method
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            val payload = bytes ?: json?.toString()?.toByteArray()
            if (payload != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", contentType ?: "application/json")
                // The relay needs the size up front: the body goes straight to storage.
                connection.setFixedLengthStreamingMode(payload.size)
                connection.outputStream.use { it.write(payload) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw RelayException(refusal(text, status, token))
            text
        } catch (e: RelayException) {
            throw e
        } catch (_: IOException) {
            throw RelayException(UNREACHABLE)
        } finally {
            connection.disconnect()
        }
    }

    private fun <T> parse(body: String, read: (JSONObject) -> T): T = try {
        read(JSONObject(body))
    } catch (_: JSONException) {
        throw RelayException(INVALID_RESPONSE)
    } catch (_: DateTimeParseException) {
        throw RelayException(INVALID_RESPONSE)
    }

    private fun instant(text: String): Instant = Instant.parse(text)

    companion object {
        const val DEFAULT_BASE = "https://i.snap2link.app"

        const val UNREACHABLE = "unreachable"
        const val INVALID_RESPONSE = "invalid_response"
        const val GUEST_REQUIRED = "guest_required"
        const val SESSION_REQUIRED = "session_required"
        const val DAILY_LIMIT = "daily_limit"
        const val PIN_LIMIT = "pin_limit"

        private const val TIMEOUT_MS = 30_000

        /** Session tokens start with this, guest tokens don't. */
        private const val SESSION_PREFIX = "s_"

        /**
         * The relay answers 401 only to say which token it wants. Some HTTP
         * stacks drop the body of a 401 after a streamed upload: the token
         * that was sent then tells which one it was.
         */
        fun refusal(body: String, status: Int, token: String?): String {
            val code = errorCode(body, status)
            if (status != 401 || code != "http_401") return code
            return if (token?.startsWith(SESSION_PREFIX) == true) SESSION_REQUIRED else GUEST_REQUIRED
        }

        /** The relay's own code, or `http_<status>` when the body has none. */
        fun errorCode(body: String, status: Int): String = try {
            JSONObject(body).getString("error").takeIf { it.matches(Regex("[a-z_]{1,40}")) }
        } catch (_: JSONException) {
            null
        } ?: "http_$status"

        /** Ids go into a path, so they have to be ids. */
        fun isCaptureId(id: String): Boolean = id.length == 22 && id.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' }
    }
}

class RelayException(val code: String) : Exception(code)

data class Created(val id: String, val url: String)

data class Session(val token: String, val email: String)

data class AccountStatus(
    val email: String,
    val plan: String,
    val capturesToday: Int,
    val dailyCaptures: Int,
    val slotsUsed: Int,
    val slots: Int,
)

data class Link(
    val id: String,
    val url: String,
    val createdAt: Instant,
    /** `null` when the link doesn't expire. */
    val expiresAt: Instant?,
    val pinned: Boolean,
    /** A small preview; Snap2Link hosting makes one at `<link>.jpg`. */
    val thumbnail: String? = null,
)

data class Links(val captures: List<Link>, val maxPins: Int)
