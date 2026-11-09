package com.snap2link.app.relay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class GuestCheckTest {
    private fun step(url: String) = GuestCheck.classify(url, "https://i.snap2link.app")

    @Test
    fun theChallengePageIsAllowed() {
        assertEquals(GuestCheck.Step.Allow, step("https://i.snap2link.app/guest"))
    }

    @Test
    fun theLastPageGivesTheToken() {
        val finish = step("https://i.snap2link.app/guest/done#turnstile=a.b%2Bc") as GuestCheck.Step.Finish
        assertEquals("a.b+c", finish.result.getOrThrow())
    }

    @Test
    fun aFailedChallengeHasItsCode() {
        val finish = step("https://i.snap2link.app/guest/done#error=600010") as GuestCheck.Step.Finish
        assertEquals("600010", (finish.result.exceptionOrNull() as GuestCheck.Failed).reason)
        for (url in listOf(
            "https://i.snap2link.app/guest/done#turnstile=",
            "https://i.snap2link.app/guest/done?turnstile=in-the-query",
            "https://i.snap2link.app/guest/done",
        )) {
            assertTrue(url, (step(url) as GuestCheck.Step.Finish).result.isFailure)
        }
    }

    @Test
    fun theWebViewCannotLeaveTheChallenge() {
        for (url in listOf(
            "https://evil.example/guest/done#turnstile=stolen",
            "http://i.snap2link.app/guest",
            "https://i.snap2link.app.evil.example/guest",
            "https://i.snap2link.app:8443/guest",
            "https://i.snap2link.app/v1/me",
            "javascript:alert(1)",
            "not a url",
        )) {
            assertEquals(url, GuestCheck.Step.Block, step(url))
        }
    }
}

class LanguageTest {
    @Test
    fun phonesGetTheRelaysLanguageCodes() {
        assertEquals("fr", Language.of(Locale.FRANCE))
        assertEquals("pt-BR", Language.of(Locale.forLanguageTag("pt-PT")))
        assertEquals("zh-TW", Language.of(Locale.forLanguageTag("zh-Hant-HK")))
        assertEquals("zh-TW", Language.of(Locale.TAIWAN))
        assertEquals("zh-CN", Language.of(Locale.forLanguageTag("zh-Hans")))
        assertEquals("he", Language.of(Locale.Builder().setLanguage("iw").setRegion("IL").build()))
        assertEquals("id", Language.of(Locale.Builder().setLanguage("in").build()))
        assertEquals("en", Language.of(Locale.forLanguageTag("nl-NL")))
    }
}
