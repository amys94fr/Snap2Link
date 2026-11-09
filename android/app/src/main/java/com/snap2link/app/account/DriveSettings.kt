package com.snap2link.app.account

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.snap2link.app.Host
import com.snap2link.app.R
import com.snap2link.app.drive.DriveClient
import com.snap2link.app.drive.DriveHosting
import com.snap2link.app.drive.PlayDriveAuth

/** Snap2Link or Google Drive, as two cards like on the desktop. */
@Composable
fun HostChoice(host: Host, onChoose: (Host) -> Unit) {
    Text(
        stringResource(R.string.settings_hosting_choose),
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() },
    )
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HostCard(
            title = stringResource(R.string.settings_host_snap2link),
            description = stringResource(R.string.settings_hosting_snap2link_card),
            selected = host == Host.SNAP2LINK,
            onSelect = { onChoose(Host.SNAP2LINK) },
            modifier = Modifier.weight(1f),
        )
        HostCard(
            title = stringResource(R.string.settings_host_drive),
            description = stringResource(R.string.settings_hosting_drive_card),
            selected = host == Host.DRIVE,
            onSelect = { onChoose(Host.DRIVE) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun HostCard(title: String, description: String, selected: Boolean, onSelect: () -> Unit, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = modifier
            .fillMaxHeight()
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect),
        shape = RoundedCornerShape(16.dp),
        color = if (selected) colors.primaryContainer else colors.surfaceContainer,
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) colors.primary else colors.outlineVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = selected, onClick = null)
                Spacer(Modifier.size(8.dp))
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
            Text(
                description,
                style = MaterialTheme.typography.bodyMedium,
                color = if (selected) colors.onPrimaryContainer else colors.onSurfaceVariant,
            )
        }
    }
}

/** The Drive account, its folder and cleanup, and who can see the captures. */
@Composable
fun DriveSettings(model: AccountViewModel) {
    val activity = LocalActivity.current as? ComponentActivity
    val context = LocalContext.current
    val email = model.driveEmail

    Text(
        stringResource(R.string.settings_host_drive),
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.semantics { heading() },
    )
    if (email == null) {
        Text(stringResource(R.string.settings_host_not_connected), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.settings_hosting_connect_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(
            onClick = { activity?.let { model.connectDrive(PlayDriveAuth(it)) } },
            enabled = !model.driveBusy && activity != null,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            if (model.driveBusy) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.size(10.dp))
            }
            Text(stringResource(R.string.settings_hosting_connect))
        }
    } else {
        SettingsCard {
            Text(stringResource(R.string.settings_hosting_account), style = MaterialTheme.typography.titleMedium)
            Text(email)
            Text(stringResource(R.string.settings_hosting_account_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { activity?.let { model.connectDrive(PlayDriveAuth(it), switching = true) } },
                    enabled = !model.driveBusy && activity != null,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.settings_switch_account)) }
                TextButton(
                    onClick = { activity?.let { model.disconnectDrive(PlayDriveAuth(it)) } },
                    enabled = !model.driveBusy && activity != null,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.settings_hosting_disconnect)) }
            }
        }

        Heading(stringResource(R.string.settings_hosting_storage))
        SettingsCard {
            Text(stringResource(R.string.settings_hosting_folder, DriveClient.FOLDER_NAME))
            Text(stringResource(R.string.settings_hosting_folder_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(
                onClick = {
                    val folder = model.driveFolder
                    val url = if (folder != null) "https://drive.google.com/drive/folders/$folder" else "https://drive.google.com/"
                    context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
                },
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Text(stringResource(R.string.settings_hosting_open_drive))
                Spacer(Modifier.size(8.dp))
                Icon(painterResource(R.drawable.ic_external), contentDescription = null, modifier = Modifier.size(16.dp))
            }
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Retention(model)
        }

        Heading(stringResource(R.string.settings_hosting_access))
        SettingsCard {
            Text(stringResource(R.string.settings_hosting_access_title))
            Text(stringResource(R.string.settings_hosting_access_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    model.driveError?.let {
        Text(
            stringResource(it),
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

@Composable
private fun Retention(model: AccountViewModel) {
    var days by remember(model.retentionDays) { mutableStateOf(model.retentionDays.toString()) }
    val typed = days.toIntOrNull()?.takeIf { it in DriveHosting.MIN_DAYS..DriveHosting.MAX_DAYS }
    val save = { typed?.let { model.setRetention(true, it) } }

    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = model.autoDelete, role = Role.Switch) { model.setRetention(it, model.retentionDays) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.settings_auto_delete), style = MaterialTheme.typography.titleSmall)
            Text(
                stringResource(
                    if (model.autoDelete) R.string.settings_hosting_auto_delete_on else R.string.settings_hosting_auto_delete_off,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = model.autoDelete, onCheckedChange = null)
    }
    if (model.autoDelete) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(
                value = days,
                onValueChange = { days = it.filter(Char::isDigit).take(4) },
                label = { Text(stringResource(R.string.settings_keep_for)) },
                suffix = { Text(stringResource(R.string.settings_days)) },
                singleLine = true,
                isError = typed == null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { save() }),
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = { save() },
                enabled = typed != null && typed != model.retentionDays,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.settings_save)) }
        }
        Text(
            stringResource(R.string.settings_delete_saved, model.retentionDays.toString()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            stringResource(R.string.settings_hosting_keep_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Heading(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(top = 8.dp).semantics { heading() },
    )
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            content()
        }
    }
}
