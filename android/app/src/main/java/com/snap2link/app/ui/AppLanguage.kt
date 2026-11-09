package com.snap2link.app.ui

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import androidx.core.content.edit
import com.snap2link.app.relay.Language
import java.util.Locale

/**
 * The app's language: the phone's by default, or one picked in the app.
 * From Android 13 the system keeps the choice (it also shows in the system
 * settings); before that the app keeps it and applies it to each screen.
 */
object AppLanguage {
    /** The 20 languages, each in its own name so anyone can find theirs. */
    val CHOICES = listOf(
        "en" to "English",
        "zh-CN" to "简体中文",
        "zh-TW" to "繁體中文",
        "es" to "Español",
        "pt-BR" to "Português (Brasil)",
        "fr" to "Français",
        "de" to "Deutsch",
        "ja" to "日本語",
        "ko" to "한국어",
        "ru" to "Русский",
        "uk" to "Українська",
        "id" to "Bahasa Indonesia",
        "hi" to "हिन्दी",
        "tr" to "Türkçe",
        "vi" to "Tiếng Việt",
        "it" to "Italiano",
        "pl" to "Polski",
        "ar" to "العربية",
        "he" to "עברית",
        "fa" to "فارسی",
    )

    private const val PREFS = "settings"
    private const val KEY = "language"

    /** The picked language, or `null` to follow the phone. */
    fun current(context: Context): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val locales = context.getSystemService(LocaleManager::class.java).applicationLocales
            return if (locales.isEmpty) null else Language.of(locales[0])
        }
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
    }

    fun set(activity: Activity, code: String?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // The system redraws every screen in the new language.
            activity.getSystemService(LocaleManager::class.java).applicationLocales =
                if (code == null) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(code)
            return
        }
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putString(KEY, code) }
        activity.recreate()
    }

    /** Before Android 13: the context each screen draws with. */
    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return base
        val code = base.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        val locale = code?.let(Locale::forLanguageTag) ?: Resources.getSystem().configuration.locales[0]
        // Dates and the language of login emails follow it too.
        Locale.setDefault(locale)
        if (code == null) return base
        val config = Configuration(base.resources.configuration)
        config.setLocales(LocaleList(locale))
        return base.createConfigurationContext(config)
    }
}
