package com.snap2link.app.relay

import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/**
 * The security check runs the relay's `/guest` page in a web view. The page
 * ends on `/guest/done#turnstile=<token>`, or `#error=<code>`, which the app
 * catches before it loads. Same rules as `guest.rs` on the desktop.
 */
object GuestCheck {
    sealed interface Step {
        /** The challenge page itself. */
        data object Allow : Step

        /** Anywhere else: the web view stays on the challenge. */
        data object Block : Step

        /** The last page: the challenge token, or the reason it failed. */
        data class Finish(val result: Result<String>) : Step
    }

    class Failed(val reason: String) : Exception(reason)

    fun page(base: String = RelayClient.DEFAULT_BASE) = "${base.trimEnd('/')}/guest"

    fun classify(target: String, base: String = RelayClient.DEFAULT_BASE): Step {
        val url = parse(target) ?: return Step.Block
        val relay = parse(base) ?: return Step.Block
        if (url.scheme != "https" || url.host != relay.host || url.port != relay.port) return Step.Block
        return when (url.rawPath) {
            "/guest" -> Step.Allow
            "/guest/done" -> Step.Finish(result(url))
            else -> Step.Block
        }
    }

    private fun result(url: URI): Result<String> {
        val fields = url.rawFragment.orEmpty().split('&').mapNotNull { pair ->
            val parts = pair.split('=', limit = 2)
            if (parts.size == 2) parts[0] to URLDecoder.decode(parts[1], "UTF-8") else null
        }.toMap()
        val token = fields["turnstile"]
        if (!token.isNullOrEmpty() && token.length <= 2_048) return Result.success(token)
        return Result.failure(Failed(fields["error"]?.take(32) ?: "unknown"))
    }

    private fun parse(text: String): URI? = try {
        URI(text)
    } catch (_: URISyntaxException) {
        null
    }
}
