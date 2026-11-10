package com.snap2link.app.detect

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.util.Size
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.snap2link.app.R
import com.snap2link.app.share.ShareActivity
import java.io.IOException

/** The notification that offers a new screenshot. A newer one replaces it. */
object ScreenshotNotice {
    private const val CHANNEL = "screenshots"
    private const val ID = 1
    private const val TIMEOUT_MS = 15 * 60 * 1000L

    fun show(context: Context, image: Uri) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        createChannel(context)

        // The same sheet as "Share, then Snap2Link".
        val send = Intent(context, ShareActivity::class.java)
            .setAction(Intent.ACTION_SEND)
            .setType("image/*")
            .putExtra(Intent.EXTRA_STREAM, image)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        send.clipData = ClipData.newRawUri(null, image)
        val open = PendingIntent.getActivity(
            context,
            0,
            send,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.detect_notification_title))
            .setContentText(context.getString(R.string.detect_notification_text))
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .addAction(0, context.getString(R.string.detect_notification_send), open)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(TIMEOUT_MS)
        thumbnail(context, image)?.let { picture ->
            builder.setLargeIcon(picture)
                .setStyle(
                    NotificationCompat.BigPictureStyle()
                        .bigPicture(picture)
                        .bigLargeIcon(null as Bitmap?)
                        .setSummaryText(context.getString(R.string.detect_notification_text)),
                )
        }
        try {
            manager.notify(ID, builder.build())
        } catch (_: SecurityException) {
            // Notifications were turned off in between.
        }
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(ID)
    }

    private fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL,
            context.getString(R.string.detect_channel),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = context.getString(R.string.detect_channel_hint)
            setShowBadge(false)
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun thumbnail(context: Context, image: Uri): Bitmap? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return try {
            context.contentResolver.loadThumbnail(image, Size(720, 720), null)
        } catch (_: IOException) {
            null
        } catch (_: SecurityException) {
            null
        }
    }
}
