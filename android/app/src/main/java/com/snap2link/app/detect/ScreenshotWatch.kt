package com.snap2link.app.detect

import android.Manifest
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit

/**
 * "Offer to send each screenshot": Android tells the app when the gallery
 * changes, without a service running all the time, and a notification offers
 * the new screenshot. Off until the person turns it on.
 */
object ScreenshotWatch {
    private const val JOB_ID = 4201
    private const val PREFS = "detect"
    private const val ENABLED = "enabled"
    private const val LAST = "last_offered"

    /** What Android still has to allow. */
    enum class Missing { PHOTOS, NOTIFICATIONS }

    /** The permissions to ask for, which depend on the Android version. */
    val permissions: Array<String> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.POST_NOTIFICATIONS)
    } else {
        arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    fun enabled(context: Context): Boolean = prefs(context).getBoolean(ENABLED, false)

    /**
     * Android 14 lets people share only some photos: a new screenshot is then
     * out of the app's reach, so all photos are needed.
     */
    fun missing(context: Context): Missing? {
        val photos = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        if (!granted(context, photos)) return Missing.PHOTOS
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return Missing.NOTIFICATIONS
        return null
    }

    fun setEnabled(context: Context, on: Boolean) {
        prefs(context).edit { putBoolean(ENABLED, on) }
        if (on) refresh(context) else stop(context)
    }

    /** Watches the gallery when the person wants it and Android allows it. */
    fun refresh(context: Context) {
        if (enabled(context) && missing(context) == null) schedule(context) else stop(context)
    }

    var Context.lastOffered: Long
        get() = prefs(this).getLong(LAST, 0)
        set(value) = prefs(this).edit { putLong(LAST, value) }

    /**
     * Android runs the job once after the gallery changes, then forgets it:
     * the job schedules itself again each time. A job watching content can't
     * survive a restart, hence [Restart].
     */
    internal fun schedule(context: Context) {
        val builder = JobInfo.Builder(JOB_ID, ComponentName(context, ScreenshotJob::class.java))
            .addTriggerContentUri(
                JobInfo.TriggerContentUri(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS,
                ),
            )
            // Screenshots are written in two steps: wait for the second.
            .setTriggerContentUpdateDelay(500)
            .setTriggerContentMaxDelay(3_000)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.addTriggerContentUri(
                JobInfo.TriggerContentUri(
                    MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                    JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS,
                ),
            )
        }
        context.getSystemService(JobScheduler::class.java).schedule(builder.build())
    }

    private fun stop(context: Context) {
        context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
        ScreenshotNotice.cancel(context)
    }

    private fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** After a restart or an update of the app, the watch starts again. */
    class Restart : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
                refresh(context)
            }
        }
    }
}
