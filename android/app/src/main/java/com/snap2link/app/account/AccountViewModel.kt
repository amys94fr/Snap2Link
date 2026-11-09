package com.snap2link.app.account

import android.app.Application
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.snap2link.app.R
import com.snap2link.app.hosting
import com.snap2link.app.relay.AccountStatus
import com.snap2link.app.relay.GuestCheck
import com.snap2link.app.relay.Language
import com.snap2link.app.relay.RelayClient
import com.snap2link.app.relay.RelayException
import com.snap2link.app.ui.accountMessage
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

class AccountViewModel(application: Application) : AndroidViewModel(application) {
    private val hosting = application.hosting

    var signedIn by mutableStateOf(hosting.signedIn)
        private set
    var status by mutableStateOf<AccountStatus?>(null)
        private set
    var loadFailed by mutableStateOf(false)
        private set

    var email by mutableStateOf("")
    var code by mutableStateOf("")

    /** The address a code went to; `null` while asking for the address. */
    var sentTo by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    @get:StringRes
    var error by mutableStateOf<Int?>(null)
        private set
    var resendIn by mutableIntStateOf(0)
        private set

    /** The security check, when sending a code needs a guest token first. */
    var needsCheck by mutableStateOf(false)
        private set

    private var countdown: Job? = null

    fun refresh() {
        signedIn = hosting.signedIn
        if (!signedIn) return
        viewModelScope.launch {
            try {
                status = hosting.account()
                loadFailed = false
            } catch (_: RelayException) {
                loadFailed = true
            }
            signedIn = hosting.signedIn
        }
    }

    fun sendCode() {
        val address = email.trim()
        if (address.isEmpty() || busy) return
        attempt {
            hosting.requestCode(address, Language.of(Locale.getDefault()))
            sentTo = address
            code = ""
            startCountdown()
        }
    }

    fun verify() {
        val address = sentTo ?: return
        val digits = code.filter(Char::isDigit)
        if (digits.length != 6 || busy) return
        attempt {
            hosting.verifyCode(address, digits)
            sentTo = null
            code = ""
            refresh()
        }
    }

    fun changeEmail() {
        sentTo = null
        code = ""
        error = null
    }

    fun onCheck(result: Result<String>) {
        needsCheck = false
        result.fold(
            onSuccess = { turnstile ->
                attempt {
                    hosting.rememberGuest(turnstile)
                    hosting.requestCode(email.trim(), Language.of(Locale.getDefault()))
                    sentTo = email.trim()
                    startCountdown()
                }
            },
            onFailure = { failure ->
                val cancelled = (failure as? GuestCheck.Failed)?.reason == "cancelled"
                error = if (cancelled) R.string.uploader_error_verification_cancelled else R.string.error_check_failed
            },
        )
    }

    fun signOut() = attempt {
        hosting.signOut()
        status = null
        signedIn = false
    }

    fun deleteAccount() = attempt {
        hosting.deleteAccount()
        status = null
        signedIn = false
    }

    private fun attempt(action: suspend () -> Unit) {
        busy = true
        error = null
        viewModelScope.launch {
            try {
                action()
            } catch (e: RelayException) {
                if (e.code == RelayClient.GUEST_REQUIRED) needsCheck = true else error = accountMessage(e.code)
            } finally {
                busy = false
            }
        }
    }

    private fun startCountdown() {
        countdown?.cancel()
        countdown = viewModelScope.launch {
            resendIn = RESEND_DELAY_SECONDS
            while (resendIn > 0) {
                delay(1_000)
                resendIn--
            }
        }
    }

    private companion object {
        const val RESEND_DELAY_SECONDS = 60
    }
}
