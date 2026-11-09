package com.snap2link.app.history

import androidx.core.net.toUri
import android.content.Intent
import android.text.format.DateFormat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import com.snap2link.app.R
import com.snap2link.app.relay.Link
import com.snap2link.app.ui.Thumbnail
import com.snap2link.app.ui.copyLink
import com.snap2link.app.ui.timeLeft
import kotlinx.coroutines.delay
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(modifier: Modifier = Modifier, model: HistoryViewModel = viewModel()) {
    // Comes back up to date after a capture sent from the share sheet.
    LifecycleResumeEffect(Unit) {
        model.load()
        onPauseOrDispose {}
    }

    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        when (val state = model.state) {
            HistoryState.Loading -> CircularProgressIndicator(Modifier.padding(48.dp))
            HistoryState.Failed -> Column(
                Modifier.padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(stringResource(R.string.history_error_load), textAlign = TextAlign.Center)
                Button(onClick = { model.load() }) { Text(stringResource(R.string.history_retry)) }
            }
            is HistoryState.Loaded -> PullToRefreshBox(
                isRefreshing = model.refreshing,
                onRefresh = { model.load(pull = true) },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    item {
                        Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 8.dp)) {
                            Text(
                                stringResource(R.string.tab_history),
                                style = MaterialTheme.typography.headlineMedium,
                                modifier = Modifier.semantics { heading() },
                            )
                            if (state.canKeep) {
                                val kept = state.links.count { it.pinned }
                                Text(
                                    stringResource(R.string.history_kept_count, kept.toString(), state.maxPins.toString()),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                                Text(
                                    stringResource(R.string.history_keep_hint_relay),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            model.actionError?.let {
                                Text(
                                    stringResource(it),
                                    color = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                        }
                    }
                    if (state.links.isEmpty()) {
                        item {
                            Text(
                                stringResource(R.string.history_empty),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(32.dp),
                            )
                        }
                    }
                    items(state.links, key = { it.id }) { link ->
                        LinkRow(
                            link = link,
                            canKeep = state.canKeep,
                            onKeep = { model.setPinned(link, !link.pinned) },
                            onDelete = { model.delete(link) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LinkRow(link: Link, canKeep: Boolean, onKeep: () -> Unit, onDelete: () -> Unit) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1_500)
            copied = false
        }
    }
    val date = DateFormat.getMediumDateFormat(context).format(Date.from(link.createdAt)) + " " +
        DateFormat.getTimeFormat(context).format(Date.from(link.createdAt))

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.widthIn(max = 640.dp).fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumbnail(
                url = "${link.url}.jpg",
                contentDescription = stringResource(R.string.history_thumbnail, date),
                modifier = Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { context.startActivity(Intent(Intent.ACTION_VIEW, link.url.toUri())) },
            )
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(date, style = MaterialTheme.typography.bodyMedium)
                Text(
                    link.expiresAt?.let { stringResource(R.string.history_ends, timeLeft(it)) }
                        ?: stringResource(R.string.history_no_end),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (copied) {
                    Text(
                        stringResource(R.string.history_copied),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            IconButton(onClick = {
                copyLink(context, link.url)
                copied = true
            }) {
                Icon(painterResource(R.drawable.ic_copy), contentDescription = stringResource(R.string.history_copy))
            }
            if (canKeep) {
                IconToggleButton(checked = link.pinned, onCheckedChange = { onKeep() }) {
                    Icon(
                        painterResource(R.drawable.ic_pin),
                        contentDescription = stringResource(if (link.pinned) R.string.history_kept else R.string.history_keep),
                        tint = if (link.pinned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            IconButton(onClick = { confirming = true }) {
                Icon(painterResource(R.drawable.ic_trash), contentDescription = stringResource(R.string.history_delete))
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.history_delete_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onDelete()
                }) { Text(stringResource(R.string.history_delete)) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.account_delete_no)) }
            },
        )
    }
}
