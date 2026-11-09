package com.snap2link.app.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/** Thumbnails already loaded, so that scrolling back doesn't load them again. */
private val cache = LruCache<String, ImageBitmap>(48)

/** The preview of a link: `<link>.jpg`, the small image the relay makes for chat apps. */
@Composable
fun Thumbnail(url: String, contentDescription: String, modifier: Modifier = Modifier) {
    val image by produceState(cache.get(url), url) {
        if (value == null) value = withContext(Dispatchers.IO) { load(url) }?.also { cache.put(url, it) }
    }
    val bitmap = image
    if (bitmap == null) {
        Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest))
    } else {
        Image(bitmap, contentDescription, modifier, contentScale = ContentScale.Crop)
    }
}

private fun load(url: String): ImageBitmap? = try {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 15_000
    connection.instanceFollowRedirects = false
    try {
        if (connection.responseCode != 200) {
            null
        } else {
            val bytes = connection.inputStream.use { it.readBytes() }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 480) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                ?.asImageBitmap()
        }
    } finally {
        connection.disconnect()
    }
} catch (_: Exception) {
    null
}
