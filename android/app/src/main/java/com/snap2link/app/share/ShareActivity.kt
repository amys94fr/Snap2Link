package com.snap2link.app.share

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import com.snap2link.app.MainActivity
import com.snap2link.app.R
import com.snap2link.app.drive.PlayDriveAuth
import com.snap2link.app.editor.EditorScreen
import com.snap2link.app.ui.AppLanguage
import com.snap2link.app.ui.GuestCheckDialog
import com.snap2link.app.ui.Snap2LinkTheme
import com.snap2link.app.ui.Success
import com.snap2link.app.ui.copyLink
import kotlinx.coroutines.delay

/**
 * "Share, then Snap2Link": sends the image and copies its link. From a
 * screenshot notification ([EXTRA_EDIT]), the editor opens first.
 */
class ShareActivity : ComponentActivity() {
    private val model: ShareViewModel by viewModels()

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLanguage.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model.driveAuth = PlayDriveAuth(this)
        model.start(sharedImage(intent), edit = intent.getBooleanExtra(EXTRA_EDIT, false))
        setContent {
            Snap2LinkTheme {
                val editing = model.state as? ShareState.Editing
                val edits = model.edits
                if (editing != null && edits != null) {
                    EditorScreen(
                        renderer = editing.renderer,
                        edits = edits,
                        onEdit = model::onEdit,
                        onCancel = { finish() },
                        onSend = model::sendEdited,
                    )
                    return@Snap2LinkTheme
                }
                ShareSheet(
                    model = model,
                    onClose = { finish() },
                    onSignUp = {
                        startActivity(
                            Intent(this, MainActivity::class.java)
                                .putExtra(MainActivity.EXTRA_TAB, MainActivity.TAB_ACCOUNT)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                        finish()
                    },
                )
            }
        }
    }

    override fun onDestroy() {
        // The model outlives a rotation; this activity doesn't.
        model.driveAuth = null
        super.onDestroy()
    }

    companion object {
        /** Opens the image in the editor before sending it. */
        const val EXTRA_EDIT = "com.snap2link.app.extra.EDIT"
    }

    private fun sharedImage(intent: Intent): Uri? {
        if (intent.action != Intent.ACTION_SEND) return null
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
    }
}

@Composable
private fun ShareSheet(model: ShareViewModel, onClose: () -> Unit, onSignUp: () -> Unit) {
    val context = LocalContext.current
    val deleteLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        if (it.resultCode == Activity.RESULT_OK) model.onDeletedFromGallery()
    }

    // A tap outside the sheet closes it, as with the system's own sheets.
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Surface(
            modifier = Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
        ) {
            Column(
                Modifier
                    .navigationBarsPadding()
                    .padding(horizontal = 24.dp, vertical = 24.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                when (val state = model.state) {
                    ShareState.Preparing, is ShareState.Editing -> Progress(stringResource(R.string.share_preparing))
                    ShareState.Sending -> Progress(stringResource(R.string.uploader_title))
                    ShareState.NeedsCheck -> {
                        Progress(stringResource(R.string.uploader_title))
                        GuestCheckDialog(onResult = model::onCheck)
                    }
                    is ShareState.Done -> Done(
                        state = state,
                        onCopy = { copyLink(context, state.url) },
                        onDelete = {
                            val item = state.galleryItem
                            if (item != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                                // Android may still refuse an item: the link is sent anyway.
                                try {
                                    val request = MediaStore.createDeleteRequest(context.contentResolver, listOf(item))
                                    deleteLauncher.launch(IntentSenderRequest.Builder(request.intentSender).build())
                                } catch (_: IllegalArgumentException) {
                                    model.onDeleteRefused()
                                } catch (_: SecurityException) {
                                    model.onDeleteRefused()
                                }
                            }
                        },
                        onClose = onClose,
                    )
                    is ShareState.Failed -> Failed(state, onRetry = model::retry, onSignUp = onSignUp, onClose = onClose)
                }
            }
        }
    }
}

@Composable
private fun Progress(label: String) {
    Row(
        Modifier.heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
        Text(label, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun Done(state: ShareState.Done, onCopy: () -> Unit, onDelete: () -> Unit, onClose: () -> Unit) {
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1_500)
            copied = false
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = Success)
        Text(stringResource(R.string.uploader_success_title), style = MaterialTheme.typography.titleLarge)
    }
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest) {
        Text(
            state.url,
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Ltr),
        )
    }
    OutlinedButton(
        onClick = {
            onCopy()
            copied = true
        },
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) {
        Icon(painterResource(R.drawable.ic_copy), contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.size(8.dp))
        Text(stringResource(if (copied) R.string.history_copied else R.string.history_copy))
    }
    if (state.galleryItem != null) {
        if (state.deleted) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = Success, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.share_deleted_from_gallery), color = Success)
            }
        } else {
            OutlinedButton(onClick = onDelete, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(painterResource(R.drawable.ic_trash), contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(stringResource(R.string.share_delete_from_gallery))
            }
        }
    }
    Button(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(stringResource(R.string.share_close))
    }
}

@Composable
private fun Failed(state: ShareState.Failed, onRetry: () -> Unit, onSignUp: () -> Unit, onClose: () -> Unit) {
    if (state.limit) {
        Text(stringResource(R.string.uploader_limit_title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.uploader_limit_subtitle), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onSignUp, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.uploader_limit_action))
        }
    } else {
        Text(stringResource(state.message), style = MaterialTheme.typography.titleMedium)
        val canRetry = state.message != R.string.share_no_image && state.message != R.string.share_unreadable &&
            state.message != R.string.error_banned
        if (canRetry) {
            Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.history_retry))
            }
        }
    }
    TextButton(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(stringResource(R.string.share_close))
    }
}
