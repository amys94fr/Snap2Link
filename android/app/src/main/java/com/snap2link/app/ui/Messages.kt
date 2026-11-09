package com.snap2link.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.icu.text.RelativeDateTimeFormatter
import androidx.annotation.StringRes
import com.snap2link.app.R
import java.time.Duration
import java.time.Instant

/** What to say when sending a capture fails, as the desktop overlay does. */
@StringRes
fun uploadMessage(code: String, signedIn: Boolean): Int = when (code) {
    "daily_limit" -> if (signedIn) R.string.uploader_error_account_daily_limit else R.string.uploader_error_daily_limit
    "service_busy", "verification_unavailable" -> R.string.uploader_error_service_busy
    "too_large" -> R.string.uploader_error_too_large
    "unreachable" -> R.string.uploader_error_unreachable
    "verification_failed" -> R.string.error_check_failed
    "guest_banned", "account_banned" -> R.string.error_banned
    else -> R.string.error_generic
}

/** What to say when signing in fails, as the desktop settings do. */
@StringRes
fun accountMessage(code: String): Int = when (code) {
    "invalid_email" -> R.string.account_error_invalid_email
    "invalid_code" -> R.string.account_error_invalid_code
    "daily_limit" -> R.string.account_error_too_many_codes
    "service_busy", "verification_unavailable" -> R.string.account_error_busy
    "mail_unavailable" -> R.string.account_error_mail
    "account_banned" -> R.string.account_error_banned
    "google_refused" -> R.string.account_error_google
    "guest_banned" -> R.string.error_banned
    "verification_failed" -> R.string.error_check_failed
    "unreachable" -> R.string.uploader_error_unreachable
    else -> R.string.error_generic
}

/** "in 23 hours", "in 40 minutes", in the phone's language. */
fun timeLeft(until: Instant, now: Instant = Instant.now()): String {
    val left = Duration.between(now, until).coerceAtLeast(Duration.ZERO)
    val formatter = RelativeDateTimeFormatter.getInstance()
    val (amount, unit) = when {
        left.toHours() >= 48 -> left.toDays().toDouble() to RelativeDateTimeFormatter.RelativeUnit.DAYS
        left.toHours() >= 1 -> left.toHours().toDouble() to RelativeDateTimeFormatter.RelativeUnit.HOURS
        else -> left.toMinutes().coerceAtLeast(1).toDouble() to RelativeDateTimeFormatter.RelativeUnit.MINUTES
    }
    return formatter.format(amount, RelativeDateTimeFormatter.Direction.NEXT, unit)
}

fun copyLink(context: Context, url: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    clipboard.setPrimaryClip(ClipData.newPlainText("Snap2Link", url))
}
