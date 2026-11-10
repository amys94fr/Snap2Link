package com.snap2link.app.detect

import com.snap2link.app.detect.Screenshots.Row
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenshotsTest {
    private val now = 1_800_000_000L

    private fun row(id: Long, folder: String? = "Pictures/Screenshots/", name: String = "Screenshot_$id.png", age: Long = 2) =
        Row(id = id, folder = folder, path = null, name = name, added = now - age)

    @Test
    fun screenshotFoldersOfTheMainPhonesAreRecognised() {
        assertTrue(Screenshots.isScreenshot(row(1, folder = "Pictures/Screenshots/")))
        assertTrue(Screenshots.isScreenshot(row(1, folder = "DCIM/Screenshots/", name = "IMG_1.jpg")))
        assertTrue(Screenshots.isScreenshot(row(1, folder = "DCIM/Screenshot/", name = "x.png")))
    }

    @Test
    fun aScreenshotNameIsEnoughInAnotherFolder() {
        assertTrue(Screenshots.isScreenshot(row(1, folder = "Pictures/", name = "Screenshot_20261110-101500.png")))
    }

    @Test
    fun beforeAndroid10ThePathIsRead() {
        val old = Row(1, folder = null, path = "/storage/emulated/0/Pictures/Screenshots/a.png", name = "a.png", added = now)
        assertTrue(Screenshots.isScreenshot(old))
    }

    @Test
    fun cameraPhotosAndDownloadsAreLeftAlone() {
        assertFalse(Screenshots.isScreenshot(row(1, folder = "DCIM/Camera/", name = "PXL_20261110.jpg")))
        assertFalse(Screenshots.isScreenshot(row(1, folder = "Download/", name = "my-screenshots-guide.png")))
        assertFalse(Screenshots.isScreenshot(row(1, folder = "Pictures/MyScreenshotsApp/", name = "a.png")))
    }

    @Test
    fun theNewestScreenshotNotYetOfferedIsOffered() {
        val rows = listOf(row(10), row(12), row(11, folder = "DCIM/Camera/", name = "PXL.jpg"))
        assertEquals(12L, Screenshots.toOffer(rows, lastOffered = 9, nowSeconds = now)?.id)
    }

    @Test
    fun aScreenshotIsNeverOfferedTwice() {
        assertNull(Screenshots.toOffer(listOf(row(12)), lastOffered = 12, nowSeconds = now))
    }

    @Test
    fun anOldScreenshotIsNotOffered() {
        assertNull(Screenshots.toOffer(listOf(row(12, age = 120)), lastOffered = 0, nowSeconds = now))
    }
}
