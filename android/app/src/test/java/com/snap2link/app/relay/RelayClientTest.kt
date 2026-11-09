package com.snap2link.app.relay

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.Instant

class RelayClientTest {
    private val relay = FakeRelay()
    private val client = RelayClient(relay.base)

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
    fun uploadSendsThePngWithTheToken() = runTest {
        val id = "a".repeat(22)
        relay.answer(201, """{"id":"$id","url":"${relay.base}/$id","delete_token":"d","expires_at":"2026-11-10T10:00:00Z"}""")
        val png = byteArrayOf(1, 2, 3)

        val created = client.upload("guest", png)

        assertEquals(Created(id, "${relay.base}/$id"), created)
        val request = relay.requests.single()
        assertEquals("POST", request.method)
        assertEquals("/v1/captures", request.path)
        assertEquals("Bearer guest", request.authorization)
        assertEquals("image/png", request.contentType)
        assertArrayEquals(png, request.body)
    }

    @Test
    fun aLinkOnAnotherHostIsRefused() = runTest {
        relay.answer(201, """{"id":"x","url":"https://evil.example/x","delete_token":"d"}""")
        assertEquals(RelayClient.INVALID_RESPONSE, failure { client.upload("guest", byteArrayOf(1)) })
    }

    @Test
    fun aLookAlikeHostIsNotTheRelay() {
        assertFalse(RelayClient("https://i.snap2link.app").isOwnLink("https://i.snap2link.app.evil.example/x"))
        assertTrue(RelayClient("https://i.snap2link.app").isOwnLink("https://i.snap2link.app/x"))
    }

    @Test
    fun refusalsKeepTheRelayCode() = runTest {
        relay.answer(429, """{"error":"daily_limit"}""")
        assertEquals(RelayClient.DAILY_LIMIT, failure { client.upload("guest", byteArrayOf(1)) })
    }

    @Test
    fun a401WithoutBodyNamesTheTokenThatWasRefused() {
        assertEquals(RelayClient.SESSION_REQUIRED, RelayClient.refusal("", 401, "s_abc"))
        assertEquals(RelayClient.GUEST_REQUIRED, RelayClient.refusal("", 401, "guest"))
        assertEquals(RelayClient.SESSION_REQUIRED, RelayClient.refusal("""{"error":"session_required"}""", 401, "guest"))
        assertEquals("http_403", RelayClient.refusal("", 403, "s_abc"))
    }

    @Test
    fun aRefusalWithoutCodeGivesTheStatus() = runTest {
        relay.answer(502, "<html>bad gateway</html>")
        assertEquals("http_502", failure { client.history("guest") })
    }

    @Test
    fun anUnreachableRelayHasItsOwnCode() = runTest {
        relay.close()
        assertEquals(RelayClient.UNREACHABLE, failure { client.history("guest") })
    }

    @Test
    fun historyKeepsOnlyTheRelaysLinks() = runTest {
        val good = "b".repeat(22)
        relay.answer(
            200,
            """{"captures":[
              {"id":"$good","url":"${relay.base}/$good","created_at":"2026-11-09T10:00:00Z","expires_at":"2026-11-11T10:00:00Z","pinned":true},
              {"id":"${"c".repeat(22)}","url":"https://evil.example/c","created_at":"2026-11-09T10:00:00Z","expires_at":null,"pinned":false},
              {"id":"../../me","url":"${relay.base}/x","created_at":"2026-11-09T10:00:00Z","expires_at":null,"pinned":false}
            ],"max_pins":5}""",
        )

        val links = client.history("s_token")

        assertEquals(5, links.maxPins)
        val link = links.captures.single()
        assertEquals(good, link.id)
        assertTrue(link.pinned)
        assertEquals(Instant.parse("2026-11-11T10:00:00Z"), link.expiresAt)
        assertEquals("Bearer s_token", relay.requests.single().authorization)
    }

    @Test
    fun aLinkWithoutEndDoesntExpire() = runTest {
        val id = "d".repeat(22)
        relay.answer(200, """{"captures":[{"id":"$id","url":"${relay.base}/$id","created_at":"2026-11-09T10:00:00Z","expires_at":null,"pinned":false}],"max_pins":0}""")
        assertNull(client.history("t").captures.single().expiresAt)
    }

    @Test
    fun pinAndDeleteUseTheCaptureId() = runTest {
        val id = "e".repeat(22)
        relay.answer(204)
        relay.answer(204)
        relay.answer(204)
        client.setPinned("s", id, true)
        client.setPinned("s", id, false)
        client.delete("s", id)
        assertEquals(
            listOf("PUT /v1/captures/$id/pin", "DELETE /v1/captures/$id/pin", "DELETE /v1/captures/$id"),
            relay.requests.map { "${it.method} ${it.path}" },
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun anIdThatIsNotAnIdNeverReachesAPath() = runTest {
        client.delete("s", "../me")
    }

    @Test
    fun signingInSendsTheCodeWithTheGuestToken() = runTest {
        relay.answer(200, """{"session_token":"s_new","email":"a@b.c"}""")
        val session = client.verifyCode("guest", "a@b.c", "123456")
        assertEquals(Session("s_new", "a@b.c"), session)
        val request = relay.requests.single()
        assertEquals("/v1/login/verify", request.path)
        assertEquals("Bearer guest", request.authorization)
        assertEquals("""{"email":"a@b.c","code":"123456"}""".length, request.body.size)
    }

    @Test
    fun theGuestTokenComesFromTheChallenge() = runTest {
        relay.answer(201, """{"guest_token":"g_new"}""")
        assertEquals("g_new", client.createGuest("turnstile-token"))
        assertEquals("/v1/guests", relay.requests.single().path)
        assertNull(relay.requests.single().authorization)
    }
}
