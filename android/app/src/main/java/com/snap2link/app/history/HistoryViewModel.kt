package com.snap2link.app.history

import android.app.Application
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.snap2link.app.R
import com.snap2link.app.hosting
import com.snap2link.app.relay.Link
import com.snap2link.app.relay.RelayClient
import com.snap2link.app.relay.RelayException
import kotlinx.coroutines.launch

sealed interface HistoryState {
    data object Loading : HistoryState
    data object Failed : HistoryState
    data class Loaded(val links: List<Link>, val maxPins: Int, val canKeep: Boolean) : HistoryState
}

class HistoryViewModel(application: Application) : AndroidViewModel(application) {
    private val hosting = application.hosting

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

    fun setPinned(link: Link, pinned: Boolean) = act {
        hosting.setPinned(link.id, pinned)
        update { links -> links.map { if (it.id == link.id) it.copy(pinned = pinned) else it } }
    }

    fun delete(link: Link) = act {
        hosting.delete(link.id)
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
            }
        }
    }
}
