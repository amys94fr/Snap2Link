package com.snap2link.app.image

import androidx.core.graphics.scale
import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlin.math.roundToInt

/**
 * Snap2Link hosting takes PNG files of 5 MB at most. Every image goes through
 * the editor, so it is decoded, then saved again as PNG, which also drops its
 * metadata, such as where a photo was taken.
 */
object Png {
    const val MAX_BYTES = 5_000_000

    /** Refuses to read more than this from a shared file. */
    private const val MAX_SOURCE_BYTES = 60_000_000

    /** The longest side a decoded image keeps, so that memory stays bounded. */
    private const val MAX_SIDE = 4_096

    class Unreadable : Exception()

    /** The image at [uri] as pixels, for the editor. Runs on a background thread. */
    fun bitmap(resolver: ContentResolver, uri: Uri): Bitmap {
        val decoded = decode(read(resolver, uri)) ?: throw Unreadable()
        // The editor reads pixels back for the blur, which a hardware bitmap won't allow.
        return if (decoded.config == Bitmap.Config.ARGB_8888) decoded else decoded.copy(Bitmap.Config.ARGB_8888, false) ?: throw Unreadable()
    }

    /** [bitmap] as a PNG small enough to send. Runs on a background thread. */
    fun encode(bitmap: Bitmap): ByteArray = fit(bitmap)

    private fun read(resolver: ContentResolver, uri: Uri): ByteArray {
        val stream = try {
            resolver.openInputStream(uri)
        } catch (_: Exception) {
            null
        } ?: throw Unreadable()
        return stream.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = try {
                    input.read(buffer)
                } catch (_: IOException) {
                    throw Unreadable()
                }
                if (read < 0) break
                out.write(buffer, 0, read)
                if (out.size() > MAX_SOURCE_BYTES) throw Unreadable()
            }
            out.toByteArray()
        }
    }

    private fun decode(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    /** Saves [bitmap] as PNG, smaller each time until it fits. */
    private fun fit(bitmap: Bitmap): ByteArray {
        var current = bitmap
        repeat(8) {
            val out = ByteArrayOutputStream()
            current.compress(Bitmap.CompressFormat.PNG, 100, out)
            if (out.size() <= MAX_BYTES) return out.toByteArray()
            val width = (current.width * 0.8).roundToInt().coerceAtLeast(1)
            val height = (current.height * 0.8).roundToInt().coerceAtLeast(1)
            current = current.scale(width, height)
        }
        throw Unreadable()
    }
}
