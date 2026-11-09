package com.snap2link.app.account

import androidx.core.net.toUri
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.Role
import com.snap2link.app.ui.AppLanguage
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import com.snap2link.app.R
import com.snap2link.app.ui.GuestCheckDialog

private const val ONLINE_ACCOUNT = "https://snap2link.app/account/"

@Composable
fun AccountScreen(modifier: Modifier = Modifier, model: AccountViewModel = viewModel()) {
    LifecycleResumeEffect(Unit) {
        model.refresh()
        onPauseOrDispose {}
    }

    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = 640.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                stringResource(R.string.tab_account),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.semantics { heading() },
            )
            if (model.signedIn) SignedIn(model) else SignIn(model)
            model.error?.let {
                Text(
                    stringResource(it),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            HorizontalDivider(Modifier.padding(top = 16.dp))
            LanguageRow()
        }
    }

    if (model.needsCheck) GuestCheckDialog(onResult = model::onCheck)
}

@Composable
private fun SignIn(model: AccountViewModel) {
    Text(stringResource(R.string.account_free_title), style = MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.account_free_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)

    val sentTo = model.sentTo
    if (sentTo == null) {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        OutlinedButton(
            onClick = {
                model.startGoogle()
                scope.launch { model.onGoogle(GoogleSignIn.idToken(context)) }
            },
            enabled = !model.busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            if (model.google) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else {
                Icon(painterResource(R.drawable.ic_google), contentDescription = null, tint = Color.Unspecified)
            }
            Spacer(Modifier.size(10.dp))
            Text(stringResource(R.string.account_google))
        }
        Text(
            stringResource(R.string.account_or_email),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
        OutlinedTextField(
            value = model.email,
            onValueChange = { model.email = it },
            label = { Text(stringResource(R.string.account_email_label)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { model.sendCode() }),
            modifier = Modifier.fillMaxWidth(),
        )
        BusyButton(
            label = stringResource(if (model.busy && !model.google) R.string.account_sending else R.string.account_send_code),
            busy = model.busy && !model.google,
            enabled = model.email.isNotBlank(),
            onClick = model::sendCode,
        )
    } else {
        Text(stringResource(R.string.account_code_sent, sentTo), color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(
            value = model.code,
            onValueChange = { model.code = it.filter(Char::isDigit).take(6) },
            label = { Text(stringResource(R.string.account_code_label)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { model.verify() }),
            modifier = Modifier.fillMaxWidth(),
        )
        BusyButton(
            label = stringResource(if (model.busy) R.string.account_verifying else R.string.account_verify),
            busy = model.busy,
            enabled = model.code.length == 6,
            onClick = model::verify,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = model::sendCode, enabled = model.resendIn == 0 && !model.busy) {
                Text(
                    if (model.resendIn > 0) stringResource(R.string.account_resend_wait, model.resendIn.toString())
                    else stringResource(R.string.account_resend),
                )
            }
            TextButton(onClick = model::changeEmail) { Text(stringResource(R.string.account_change_email)) }
        }
    }
}

@Composable
private fun SignedIn(model: AccountViewModel) {
    val context = LocalContext.current
    var confirmDelete by remember { mutableStateOf(false) }
    val status = model.status

    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when {
                status != null -> {
                    Text(status.email, style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.account_plan_free), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    HorizontalDivider()
                    Usage(stringResource(R.string.account_captures_today), status.capturesToday, status.dailyCaptures)
                    Usage(stringResource(R.string.account_active_links), status.slotsUsed, status.slots)
                    Text(
                        stringResource(R.string.account_active_links_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                model.loadFailed -> {
                    Text(stringResource(R.string.account_load_failed))
                    TextButton(onClick = model::refresh) { Text(stringResource(R.string.account_retry)) }
                }
                else -> CircularProgressIndicator(Modifier.size(28.dp))
            }
        }
    }

    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.account_online_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.account_online_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, ONLINE_ACCOUNT.toUri())) },
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Text(stringResource(R.string.account_online_open))
                Spacer(Modifier.size(8.dp))
                Icon(painterResource(R.drawable.ic_external), contentDescription = null, modifier = Modifier.size(16.dp))
            }
        }
    }

    OutlinedButton(
        onClick = model::signOut,
        enabled = !model.busy,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) { Text(stringResource(R.string.account_sign_out)) }

    Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.account_delete_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.account_delete_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(
            onClick = { confirmDelete = true },
            enabled = !model.busy,
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) { Text(stringResource(R.string.account_delete)) }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            text = { Text(stringResource(R.string.account_delete_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDelete = false
                        model.deleteAccount()
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.account_delete_yes)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.account_delete_no)) }
            },
        )
    }
}

@Composable
private fun Usage(label: String, used: Int, limit: Int) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f))
        Text("$used / $limit", style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun BusyButton(label: String, busy: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(
                Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
            Spacer(Modifier.size(10.dp))
        }
        Text(label)
    }
}

@Composable
private fun LanguageRow() {
    val context = LocalContext.current
    var picking by remember { mutableStateOf(false) }
    val current = AppLanguage.current(context)
    val currentName = AppLanguage.CHOICES.firstOrNull { it.first == current }?.second
        ?: stringResource(R.string.settings_general_language_auto)

    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(role = Role.Button) { picking = true },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(painterResource(R.drawable.ic_language), contentDescription = null)
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.settings_general_language), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.settings_general_language_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(currentName, color = MaterialTheme.colorScheme.primary)
    }

    if (picking) {
        val choices = listOf<Pair<String?, String>>(null to stringResource(R.string.settings_general_language_auto)) +
            AppLanguage.CHOICES
        AlertDialog(
            onDismissRequest = { picking = false },
            title = { Text(stringResource(R.string.settings_general_language)) },
            text = {
                Column(Modifier.selectableGroup().verticalScroll(rememberScrollState())) {
                    choices.forEach { (code, name) ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp)
                                .selectable(
                                    selected = code == current,
                                    role = Role.RadioButton,
                                    onClick = {
                                        picking = false
                                        if (code != current) context.activity()?.let { AppLanguage.set(it, code) }
                                    },
                                ),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = code == current, onClick = null)
                            Spacer(Modifier.size(12.dp))
                            Text(name)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { picking = false }) { Text(stringResource(R.string.share_close)) }
            },
        )
    }
}

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}
