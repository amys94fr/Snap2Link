package com.snap2link.app.relay

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class HostingTest {
    private val relay = FakeRelay()
    private val id = "a".repeat(22)
    private val created get() = """{"id":"$id","url":"${relay.base}/$id","delete_token":"d"}"""

    @After
    fun stop() = relay.close()

    private suspend fun failure(call: suspend () -> Unit): String {
        try {
            call()
        } catch (e: RelayException) {
            return e.code
        }
        fail("expected a RelayException")
        error("unreachable")
    }

    @Test
    fun aSignedInPhoneSendsWithItsSession() = runTest {
        val hosting = Hosting(RelayClient(relay.base), MemoryTokens(guest = "g", session = "s", email = "a@b.c"))
        relay.answer(201, created)
        hosting.upload(byteArrayOf(1))
        assertEquals("Bearer s", relay.requests.single().authorization)
    }

    @Test
    fun aRefusedSessionFallsBackToTheGuest() = runTest {
        val tokens = MemoryTokens(guest = "g", session = "s_x", email = "a@b.c")
        val hosting = Hosting(RelayClient(relay.base), tokens)
        relay.answer(401, """{"error":"session_required"}""")
        relay.answer(201, created)

        hosting.upload(byteArrayOf(1))

        assertEquals(listOf("Bearer s_x", "Bearer g"), relay.requests.map { it.authorization })
        assertNull(tokens.session)
        assertNull(tokens.email)
        assertFalse(hosting.signedIn)
    }

    @Test
    fun withoutAGuestTokenTheCheckComesFirst() = runTest {
        val hosting = Hosting(RelayClient(relay.base), MemoryTokens())
        assertEquals(RelayClient.GUEST_REQUIRED, failure { hosting.upload(byteArrayOf(1)) })
        assertEquals(0, relay.requests.size)
    }

    @Test
    fun aRefusedGuestTokenIsForgotten() = runTest {
        val tokens = MemoryTokens(guest = "old")
        val hosting = Hosting(RelayClient(relay.base), tokens)
        relay.answer(401, """{"error":"guest_required"}""")
        assertEquals(RelayClient.GUEST_REQUIRED, failure { hosting.upload(byteArrayOf(1)) })
        assertNull(tokens.guest)
    }

    @Test
    fun theCheckGivesAGuestToken() = runTest {
        val tokens = MemoryTokens()
        relay.answer(201, """{"guest_token":"g_new"}""")
        Hosting(RelayClient(relay.base), tokens).rememberGuest("turnstile")
        assertEquals("g_new", tokens.guest)
    }

    @Test
    fun aVerifiedCodeKeepsTheSession() = runTest {
        val tokens = MemoryTokens(guest = "g")
        relay.answer(200, """{"session_token":"s_new","email":"a@b.c"}""")
        Hosting(RelayClient(relay.base), tokens).verifyCode("a@b.c", "123456")
        assertEquals("s_new", tokens.session)
        assertEquals("a@b.c", tokens.email)
    }

    @Test
    fun signingOutWorksOffline() = runTest {
        val tokens = MemoryTokens(guest = "g", session = "s", email = "a@b.c")
        val hosting = Hosting(RelayClient(relay.base), tokens)
        relay.close()
        hosting.signOut()
        assertNull(tokens.session)
    }

    @Test
    fun keepingNeedsAnAccount() = runTest {
        val hosting = Hosting(RelayClient(relay.base), MemoryTokens(guest = "g"))
        assertEquals(RelayClient.SESSION_REQUIRED, failure { hosting.setPinned(id, true) })
    }

    @Test
    fun noTokenMeansNoHistoryYet() = runTest {
        assertNull(Hosting(RelayClient(relay.base), MemoryTokens()).history())
    }
}
