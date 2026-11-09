package com.snap2link.app.drive

import com.snap2link.app.relay.FakeRelay
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class DriveTest {
    private val drive = FakeRelay()
    private val client = DriveClient(drive.base)
    private val now = Instant.parse("2026-11-09T12:00:00Z")

    @After
    fun stop() = drive.close()

    @Test
    fun theFolderIsFoundByNameBeforeBeingCreated() = runTest {
        drive.answer(200, """{"files":[{"id":"folder_1"}]}""")

        assertEquals("folder_1", client.folder("t", known = null))
        val query = drive.requests.single().query!!
        assertTrue(query.contains("name='Snap2Link'"))
        assertTrue(query.contains("trashed=false"))
    }

    @Test
    fun aTrashedFolderIsReplaced() = runTest {
        drive.answer(200, """{"id":"old","trashed":true}""")
        drive.answer(200, """{"files":[]}""")
        drive.answer(200, """{"id":"new_1"}""")

        assertEquals("new_1", client.folder("t", known = "old"))
        assertEquals("POST", drive.requests.last().method)
        assertEquals("application/vnd.google-apps.folder", JSONObject(drive.requests.last().body.decodeToString()).getString("mimeType"))
    }

    @Test
    fun anUploadGoesToTheFolderAndBecomesPublic() = runTest {
        drive.answer(200, """{"id":"file_1","createdTime":"2026-11-09T12:00:00Z"}""")
        drive.answer(200, """{"id":"perm"}""")
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte())

        val link = client.upload("token", "folder_1", png, now)

        assertEquals("https://drive.google.com/uc?id=file_1&export=download", link.url)
        val (upload, permission) = drive.requests
        assertEquals("Bearer token", upload.authorization)
        assertTrue(upload.contentType!!.startsWith("multipart/related; boundary="))
        val body = upload.body.decodeToString()
        assertTrue(body.contains(""""parents":["folder_1"]"""))
        assertTrue(body.contains("screenshot_2026-11-09_12-00-00.png"))
        assertEquals("/drive/v3/files/file_1/permissions", permission.path)
        assertEquals("anyone", JSONObject(permission.body.decodeToString()).getString("type"))
    }

    @Test
    fun historyShowsWhenEachCaptureEndsUnlessItIsKept() = runTest {
        drive.answer(
            200,
            """{"files":[
                {"id":"a","createdTime":"2026-11-01T00:00:00Z","thumbnailLink":"https://lh3.googleusercontent.com/a"},
                {"id":"b","createdTime":"2026-11-02T00:00:00Z","appProperties":{"snap2link_keep":"1"}},
                {"id":"bad id","createdTime":"2026-11-02T00:00:00Z"}
            ]}""",
        )

        val links = client.history("t", "folder_1", retentionDays = 30)

        assertEquals(listOf("a", "b"), links.map { it.id })
        assertEquals(Instant.parse("2026-12-01T00:00:00Z"), links[0].expiresAt)
        assertEquals("https://lh3.googleusercontent.com/a", links[0].thumbnail)
        assertTrue(links[1].pinned)
        assertNull(links[1].expiresAt)
    }

    @Test
    fun withoutTheCleanupNothingEnds() = runTest {
        drive.answer(200, """{"files":[{"id":"a","createdTime":"2026-11-01T00:00:00Z"}]}""")

        assertNull(client.history("t", "folder_1", retentionDays = null).single().expiresAt)
    }

    @Test
    fun keepingWritesTheAppProperty() = runTest {
        drive.answer(200, "{}")
        drive.answer(200, "{}")

        client.setKept("t", "a", kept = true)
        client.setKept("t", "a", kept = false)

        val (keep, release) = drive.requests
        assertEquals("PATCH", keep.methodOverride)
        assertEquals("1", JSONObject(keep.body.decodeToString()).getJSONObject("appProperties").getString("snap2link_keep"))
        assertTrue(JSONObject(release.body.decodeToString()).getJSONObject("appProperties").isNull("snap2link_keep"))
    }

    @Test
    fun theCleanupLeavesKeptCapturesAndFollowsPages() = runTest {
        drive.answer(200, """{"files":[{"id":"a"}],"nextPageToken":"p2"}""")
        drive.answer(204)
        drive.answer(200, """{"files":[{"id":"b"}]}""")
        drive.answer(204)

        assertEquals(2, client.cleanup("t", "folder_1", days = 30, now = now))
        val query = drive.requests[0].query!!
        assertTrue(query.contains("createdTime < '2026-10-10T12:00:00'"))
        assertTrue(query.contains("not appProperties has { key='snap2link_keep' and value='1' }"))
        assertTrue(drive.requests.map { "${it.method} ${it.path} ${it.query}" }.toString(), drive.requests[2].query!!.contains("pageToken=p2"))
        assertEquals(listOf("/drive/v3/files/a", "/drive/v3/files/b"), drive.requests.filter { it.method == "DELETE" }.map { it.path })
    }

    @Test
    fun aRefusedTokenIsNamed() = runTest {
        drive.answer(401, """{"error":{"code":401}}""")

        val e = assertThrows(DriveException::class.java) { kotlinx.coroutines.runBlocking { client.email("t") } }
        assertEquals(DriveClient.UNAUTHORIZED, e.code)
    }

    @Test
    fun idsThatAreNotDriveIdsNeverReachAPath() {
        assertTrue(DriveClient.isDriveId("1AbC-d_9"))
        assertFalse(DriveClient.isDriveId(""))
        assertFalse(DriveClient.isDriveId("../files"))
        assertFalse(DriveClient.isDriveId("a b"))
        assertFalse(DriveClient.isDriveId("é"))
    }

    @Test
    fun hostingTriesOnceMoreWithANewTokenAfterARefusal() = runTest {
        val store = MemoryDrive(email = "me@example.com", folder = "folder_1")
        val hosting = DriveHosting(client, store)
        val auth = FakeAuth()
        drive.answer(401) // the first token is refused
        drive.answer(200, """{"id":"folder_1","trashed":false}""")
        drive.answer(200, """{"files":[]}""")

        assertEquals(emptyList<Any>(), hosting.history(auth))
        assertEquals(listOf("token-1"), auth.cleared)
        assertEquals("Bearer token-2", drive.requests.last().authorization)
    }

    @Test
    fun theCleanupRunsAtMostEveryTwelveHours() = runTest {
        val store = MemoryDrive(email = "me@example.com", folder = "folder_1")
        val hosting = DriveHosting(client, store)
        drive.answer(200, """{"id":"folder_1"}""")
        drive.answer(200, """{"files":[]}""")

        assertTrue(hosting.cleanupIfDue(FakeAuth(), now))
        assertFalse(hosting.cleanupIfDue(FakeAuth(), now.plusSeconds(3600)))
        assertEquals(2, drive.requests.size)
    }

    @Test
    fun uploadingWithoutAnAccountAsksToConnect() = runTest {
        val hosting = DriveHosting(client, MemoryDrive())

        val e = assertThrows(DriveException::class.java) {
            kotlinx.coroutines.runBlocking { hosting.upload(FakeAuth(), byteArrayOf(1)) }
        }
        assertEquals(PlayDriveAuth.NOT_CONNECTED, e.code)
        assertTrue(drive.requests.isEmpty())
    }

    private class FakeAuth : DriveAuth {
        private var issued = 0
        val cleared = mutableListOf<String>()
        override suspend fun token() = "token-${++issued}"
        override suspend fun clear(token: String) {
            cleared += token
        }
        override suspend fun revoke(email: String) = Unit
    }

    private class MemoryDrive(
        override var email: String? = null,
        override var folder: String? = null,
        override var autoDelete: Boolean = true,
        override var retentionDays: Int = 30,
        override var lastCleanup: Long = 0,
    ) : DriveStore
}
