package com.snap2link.app.history

import android.app.Application
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.snap2link.app.Host
import com.snap2link.app.R
import com.snap2link.app.drive
import com.snap2link.app.drive.DriveAuth
import com.snap2link.app.drive.DriveException
import com.snap2link.app.host
import com.snap2link.app.hosting
import com.snap2link.app.relay.Link
import com.snap2link.app.relay.RelayClient
import com.snap2link.app.relay.RelayException
import kotlinx.coroutines.launch

sealed interface HistoryState {
    data object Loading : HistoryState
    data object Failed : HistoryState

    /** Drive is the chosen host, but no account is connected. */
    data object DriveNeeded : HistoryState

    /** [drive]: Drive keeps as many links as the person likes, with no count to show. */
    data class Loaded(
        val links: List<Link>,
        val maxPins: Int,
        val canKeep: Boolean,
        val drive: Boolean = false,
    ) : HistoryState
}

class HistoryViewModel(application: Application) : AndroidViewModel(application) {
    private val hosting = application.hosting
    private val drive = application.drive

    /** Set by the screen: Drive may need to show its consent screen again. */
    var driveAuth: DriveAuth? = null

    var state by mutableStateOf<HistoryState>(HistoryState.Loading)
        private set

    /** Shown under the list after a refused action; cleared by the next one. */
    @get:StringRes
    var actionError by mutableStateOf<Int?>(null)
        private set

    var refreshing by mutableStateOf(false)
        private set

    fun load(pull: Boolean = false) {
        if (pull) refreshing = true else if (state !is HistoryState.Loaded) state = HistoryState.Loading
        if (getApplication<Application>().host == Host.DRIVE) return loadDrive()
        viewModelScope.launch {
            state = try {
                val links = hosting.history()
                if (links == null) {
                    HistoryState.Loaded(emptyList(), 0, canKeep = false)
                } else {
                    HistoryState.Loaded(links.captures, links.maxPins, canKeep = hosting.signedIn && links.maxPins > 0)
                }
            } catch (_: RelayException) {
                HistoryState.Failed
            }
            refreshing = false
        }
    }

    private fun loadDrive() {
        val auth = driveAuth
        if (!drive.connected || auth == null) {
            state = HistoryState.DriveNeeded
            refreshing = false
            return
        }
        viewModelScope.launch {
            state = try {
                // The cleanup first, so that the list doesn't show what it removes.
                try {
                    drive.cleanupIfDue(auth)
                } catch (_: DriveException) {
                }
                HistoryState.Loaded(drive.history(auth), maxPins = 0, canKeep = true, drive = true)
            } catch (e: DriveException) {
                when (e.code) {
                    com.snap2link.app.drive.PlayDriveAuth.NOT_CONNECTED,
                    com.snap2link.app.drive.PlayDriveAuth.CANCELLED,
                    -> HistoryState.DriveNeeded
                    else -> HistoryState.Failed
                }
            }
            refreshing = false
        }
    }

    private val onDrive get() = (state as? HistoryState.Loaded)?.drive == true

    fun setPinned(link: Link, pinned: Boolean) = act {
        val auth = driveAuth
        if (onDrive && auth != null) drive.setKept(auth, link.id, pinned) else hosting.setPinned(link.id, pinned)
        update { links -> links.map { if (it.id == link.id) it.copy(pinned = pinned) else it } }
    }

    fun delete(link: Link) = act {
        val auth = driveAuth
        if (onDrive && auth != null) drive.delete(auth, link.id) else hosting.delete(link.id)
        update { links -> links.filterNot { it.id == link.id } }
    }

    private fun update(change: (List<Link>) -> List<Link>) {
        (state as? HistoryState.Loaded)?.let { state = it.copy(links = change(it.links)) }
    }

    private fun act(action: suspend () -> Unit) {
        actionError = null
        viewModelScope.launch {
            try {
                action()
            } catch (e: RelayException) {
                actionError = if (e.code == RelayClient.PIN_LIMIT) R.string.history_error_pin_limit else R.string.history_error_action
            } catch (_: DriveException) {
                actionError = R.string.history_error_action
            }
        }
    }
}
