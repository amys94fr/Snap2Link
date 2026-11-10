package com.snap2link.app.detect

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.snap2link.app.R

/** The watch as a screen sees it, read again each time the screen comes back. */
class WatchControl(
    val enabled: Boolean,
    val missing: ScreenshotWatch.Missing?,
    val turn: (Boolean) -> Unit,
    val openSystemSettings: () -> Unit,
) {
    val active get() = enabled && missing == null
}

@Composable
fun rememberWatchControl(): WatchControl {
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(ScreenshotWatch.enabled(context)) }
    var missing by remember { mutableStateOf(ScreenshotWatch.missing(context)) }

    // Permissions can change in the system settings while the app is away.
    LifecycleResumeEffect(Unit) {
        enabled = ScreenshotWatch.enabled(context)
        missing = ScreenshotWatch.missing(context)
        ScreenshotWatch.refresh(context)
        onPauseOrDispose {}
    }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        missing = ScreenshotWatch.missing(context)
        ScreenshotWatch.refresh(context)
    }

    return WatchControl(
        enabled = enabled,
        missing = missing,
        turn = { on ->
            ScreenshotWatch.setEnabled(context, on)
            enabled = on
            if (on && ScreenshotWatch.missing(context) != null) ask.launch(ScreenshotWatch.permissions)
        },
        openSystemSettings = {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        },
    )
}

/** The settings row: a switch, and what Android still has to allow. */
@Composable
fun WatchSetting(control: WatchControl) {
    Text(
        stringResource(R.string.detect_title),
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.semantics { heading() },
    )
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .toggleable(value = control.enabled, role = Role.Switch, onValueChange = control.turn),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.detect_switch), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.detect_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = control.enabled, onCheckedChange = null)
    }
    if (control.enabled) MissingNote(control)
}

/** On the home screen, until the watch runs. */
@Composable
fun WatchCard(control: WatchControl) {
    if (control.active) return
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primaryContainer) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                stringResource(R.string.home_detect_title),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                stringResource(R.string.detect_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            if (control.enabled) {
                MissingNote(control)
            } else {
                Button(onClick = { control.turn(true) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.home_detect_action))
                }
            }
        }
    }
}

@Composable
private fun MissingNote(control: WatchControl) {
    val missing = control.missing ?: return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            stringResource(
                if (missing == ScreenshotWatch.Missing.PHOTOS) R.string.detect_photos_needed
                else R.string.detect_notifications_needed,
            ),
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        OutlinedButton(onClick = control.openSystemSettings, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.detect_open_settings))
        }
        TextButton(onClick = { control.turn(false) }, contentPadding = PaddingValues(horizontal = 0.dp)) {
            Text(stringResource(R.string.detect_turn_off))
        }
    }
}
