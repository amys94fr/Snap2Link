package com.snap2link.app.image

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PngTest {
    @Test
    fun aPngIsRecognisedByItsSignature() {
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0)
        assertTrue(Png.isPng(png))
    }

    @Test
    fun otherFormatsAreNotPng() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0, 0, 0, 0, 0)
        assertFalse(Png.isPng(jpeg))
        assertFalse(Png.isPng(byteArrayOf(0x89.toByte(), 0x50)))
        assertFalse(Png.isPng(ByteArray(0)))
    }
}
