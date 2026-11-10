package com.snap2link.app.share

import android.app.Application
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.snap2link.app.Host
import com.snap2link.app.R
import com.snap2link.app.detect.ScreenshotNotice
import com.snap2link.app.drive
import com.snap2link.app.drive.DriveAuth
import com.snap2link.app.drive.DriveException
import com.snap2link.app.host
import com.snap2link.app.hosting
import com.snap2link.app.image.Png
import com.snap2link.app.relay.GuestCheck
import com.snap2link.app.relay.RelayClient
import com.snap2link.app.relay.RelayException
import com.snap2link.app.ui.copyLink
import com.snap2link.app.ui.driveMessage
import com.snap2link.app.ui.uploadMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface ShareState {
    data object Preparing : ShareState
    data object Sending : ShareState

    /** No guest token yet: the security check runs first. */
    data object NeedsCheck : ShareState

    /** [galleryItem]: the image to offer deleting, when Android allows it. */
    data class Done(val url: String, val galleryItem: Uri?, val deleted: Boolean = false) : ShareState

    /** [limit] when the guest reached the daily limit, to offer an account. */
    data class Failed(@StringRes val message: Int, val limit: Boolean = false) : ShareState
}

class ShareViewModel(application: Application) : AndroidViewModel(application) {
    private val hosting = application.hosting
    private val drive = application.drive

    /** Set by the activity: Drive's consent screen needs one to show. */
    var driveAuth: DriveAuth? = null
    private var png: ByteArray? = null
    private var source: Uri? = null

    var state by mutableStateOf<ShareState>(ShareState.Preparing)
        private set

    /** Runs once per shared image, even when the screen turns. */
    fun start(uri: Uri?) {
        if (source != null || png != null) return
        if (uri == null) {
            state = ShareState.Failed(R.string.share_no_image)
            return
        }
        source = uri
        viewModelScope.launch {
            png = try {
                withContext(Dispatchers.IO) { Png.from(getApplication<Application>().contentResolver, uri) }
            } catch (_: Png.Unreadable) {
                state = ShareState.Failed(R.string.share_unreadable)
                return@launch
            } catch (_: SecurityException) {
                state = ShareState.Failed(R.string.share_unreadable)
                return@launch
            }
            send()
        }
    }

    fun onCheck(result: Result<String>) {
        result.fold(
            onSuccess = { turnstile ->
                state = ShareState.Sending
                viewModelScope.launch {
                    try {
                        hosting.rememberGuest(turnstile)
                        send()
                    } catch (e: RelayException) {
                        state = ShareState.Failed(uploadMessage(e.code, hosting.signedIn))
                    }
                }
            },
            onFailure = { failure ->
                val cancelled = (failure as? GuestCheck.Failed)?.reason == "cancelled"
                state = ShareState.Failed(
                    if (cancelled) R.string.uploader_error_verification_cancelled else R.string.error_check_failed,
                )
            },
        )
    }

    fun retry() {
        if (png != null) viewModelScope.launch { send() }
    }

    /** Hides the button when Android won't delete this image. */
    fun onDeleteRefused() {
        (state as? ShareState.Done)?.let { state = it.copy(galleryItem = null) }
    }

    fun onDeletedFromGallery() {
        (state as? ShareState.Done)?.let { state = it.copy(deleted = true) }
    }

    private suspend fun send() {
        val bytes = png ?: return
        state = ShareState.Sending
        if (getApplication<Application>().host == Host.DRIVE) return sendToDrive(bytes)
        state = try {
            val created = hosting.upload(bytes)
            copyLink(getApplication(), created.url)
            ScreenshotNotice.cancel(getApplication())
            ShareState.Done(created.url, galleryItem = galleryItem(source))
        } catch (e: RelayException) {
            when (e.code) {
                RelayClient.GUEST_REQUIRED -> ShareState.NeedsCheck
                RelayClient.DAILY_LIMIT -> ShareState.Failed(
                    uploadMessage(e.code, hosting.signedIn),
                    limit = !hosting.signedIn,
                )
                else -> ShareState.Failed(uploadMessage(e.code, hosting.signedIn))
            }
        }
    }

    private suspend fun sendToDrive(bytes: ByteArray) {
        val auth = driveAuth ?: return
        state = try {
            val link = drive.upload(auth, bytes)
            copyLink(getApplication(), link.url)
            ScreenshotNotice.cancel(getApplication())
            ShareState.Done(link.url, galleryItem = galleryItem(source))
        } catch (e: DriveException) {
            ShareState.Failed(driveMessage(e.code))
        }
        // Old captures leave the Drive, as on the desktop; a failure waits for next time.
        viewModelScope.launch {
            try {
                drive.cleanupIfDue(auth)
            } catch (_: DriveException) {
            }
        }
    }

    companion object {
        /**
         * The gallery item behind a shared image, which Android can delete
         * after asking, from Android 11 on: `content://media/external/images/media/42`.
         * Gallery apps such as Google Photos share their own address with that
         * one inside it. The photo picker's copies (`content://media/picker/...`)
         * can't be deleted.
         */
        fun galleryItem(uri: Uri?): Uri? {
            if (uri == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
            if (isMediaItem(uri)) return uri
            return uri.pathSegments
                .filter { it.startsWith("content://${MediaStore.AUTHORITY}/") }
                .map(Uri::parse)
                .firstOrNull(::isMediaItem)
        }

        private fun isMediaItem(uri: Uri): Boolean {
            if (uri.scheme != "content" || uri.authority != MediaStore.AUTHORITY) return false
            val segments = uri.pathSegments
            return segments.size >= 2 && segments.first().startsWith("external") &&
                segments.last().all(Char::isDigit) && "picker" !in segments
        }
    }
}
