package com.snap2link.app.relay

import java.util.Locale

/** The 20 languages of Snap2Link, as the relay names them for its emails. */
object Language {
    private val CODES = setOf(
        "ar", "de", "en", "es", "fa", "fr", "he", "hi", "id", "it",
        "ja", "ko", "pl", "pt-BR", "ru", "tr", "uk", "vi", "zh-CN", "zh-TW",
    )

    fun of(locale: Locale): String {
        val code = when (val language = locale.language) {
            // Older Android versions still use the retired codes.
            "iw" -> "he"
            "in" -> "id"
            "pt" -> "pt-BR"
            "zh" -> if (locale.script == "Hant" || locale.country in setOf("TW", "HK", "MO")) "zh-TW" else "zh-CN"
            else -> language
        }
        return if (code in CODES) code else "en"
    }
}
