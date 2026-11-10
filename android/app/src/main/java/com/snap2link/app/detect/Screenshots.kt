package com.snap2link.app.detect

/**
 * Which new gallery images are screenshots, kept apart from Android so the
 * rules can be tested.
 */
object Screenshots {
    /** A gallery image, as MediaStore describes it. */
    data class Row(
        val id: Long,
        /** `Pictures/Screenshots/` from Android 10, else `null`. */
        val folder: String?,
        /** The full path before Android 10, else `null`. */
        val path: String?,
        val name: String?,
        /** Seconds since 1970, as MediaStore keeps it. */
        val added: Long,
    )

    /** How recent an image must be: an older one isn't the screenshot just taken. */
    const val RECENT_SECONDS = 60L

    /**
     * Phones keep screenshots in a "Screenshots" folder (Pixel, Samsung,
     * Xiaomi, OnePlus...), or name them "Screenshot_...", whatever their language.
     */
    fun isScreenshot(row: Row): Boolean {
        val folder = (row.folder ?: row.path?.substringBeforeLast('/', ""))?.lowercase().orEmpty()
        if (folder.split('/').any { it == "screenshots" || it == "screenshot" }) return true
        val name = row.name?.lowercase().orEmpty()
        return name.startsWith("screenshot")
    }

    /**
     * The screenshot to offer, if any: the newest one taken in the last minute
     * that wasn't offered yet. MediaStore numbers its images in order, so
     * [lastOffered] is enough to never offer one twice.
     */
    fun toOffer(rows: List<Row>, lastOffered: Long, nowSeconds: Long): Row? = rows
        .filter { it.id > lastOffered && nowSeconds - it.added <= RECENT_SECONDS && isScreenshot(it) }
        .maxByOrNull { it.id }
}
