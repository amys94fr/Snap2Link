package com.snap2link.app.detect

import android.app.job.JobParameters
import android.app.job.JobService
import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import com.snap2link.app.detect.ScreenshotWatch.lastOffered
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Runs when the gallery changes: offers the new screenshot, if there is one. */
class ScreenshotJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var work: Job? = null

    override fun onStartJob(params: JobParameters): Boolean {
        work = scope.launch {
            try {
                find(this@ScreenshotJob)?.let { row ->
                    lastOffered = row.id
                    ScreenshotNotice.show(this@ScreenshotJob, contentUri(row.id))
                }
            } catch (e: SecurityException) {
                // The photo permission was taken back: the next refresh stops the watch.
                Log.w("Snap2Link", "Screenshot watch: ${e.javaClass.simpleName}")
            } finally {
                jobFinished(params, false)
                ScreenshotWatch.refresh(this@ScreenshotJob)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        work?.cancel()
        // Changes keep coming: the watch is scheduled again in any case.
        return false
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /**
     * A screenshot only shows in MediaStore once fully written, which can come
     * just after the change that started the job: look again a few times.
     */
    private suspend fun find(context: Context): Screenshots.Row? {
        repeat(ATTEMPTS) { attempt ->
            if (attempt > 0) delay(1_000)
            val now = System.currentTimeMillis() / 1000
            Screenshots.toOffer(recent(context, now), context.lastOffered, now)?.let { return it }
        }
        return null
    }

    @Suppress("DEPRECATION") // DATA is the only path before Android 10.
    private fun recent(context: Context, now: Long): List<Screenshots.Row> {
        val modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        val projection = buildList {
            add(MediaStore.Images.Media._ID)
            add(MediaStore.Images.Media.DISPLAY_NAME)
            add(MediaStore.Images.Media.DATE_ADDED)
            add(if (modern) MediaStore.Images.Media.RELATIVE_PATH else MediaStore.Images.Media.DATA)
        }.toTypedArray()
        val rows = mutableListOf<Screenshots.Row>()
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            "${MediaStore.Images.Media.DATE_ADDED} >= ?",
            arrayOf((now - Screenshots.RECENT_SECONDS).toString()),
            "${MediaStore.Images.Media._ID} DESC",
        )?.use { cursor ->
            while (cursor.moveToNext() && rows.size < 20) {
                val place = cursor.getString(3)
                rows += Screenshots.Row(
                    id = cursor.getLong(0),
                    folder = if (modern) place else null,
                    path = if (modern) null else place,
                    name = cursor.getString(1),
                    added = cursor.getLong(2),
                )
            }
        }
        return rows
    }

    private fun contentUri(id: Long) = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)

    private companion object {
        const val ATTEMPTS = 4
    }
}
