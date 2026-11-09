package com.snap2link.app.account

import android.app.Application
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.snap2link.app.Host
import com.snap2link.app.R
import com.snap2link.app.drive
import com.snap2link.app.drive.DriveAuth
import com.snap2link.app.drive.DriveClient
import com.snap2link.app.drive.DriveException
import com.snap2link.app.drive.PlayDriveAuth
import com.snap2link.app.host
import com.snap2link.app.ui.driveMessage
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
    private val drive = application.drive

    /** Where captures go; each host shows only its own options. */
    var host by mutableStateOf(application.host)
        private set

    var driveEmail by mutableStateOf(drive.email)
        private set
    var driveBusy by mutableStateOf(false)
        private set

    @get:StringRes
    var driveError by mutableStateOf<Int?>(null)
        private set
    var autoDelete by mutableStateOf(drive.autoDelete)
        private set
    var retentionDays by mutableIntStateOf(drive.retentionDays)
        private set
    val driveFolder: String? get() = drive.folder

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

    /** True while "Continue with Google" runs, so only its button spins. */
    var google by mutableStateOf(false)
        private set

    /** A Google ID token waiting for the security check. */
    private var pendingGoogle: String? = null

    /** The security check, when sending a code needs a guest token first. */
    var needsCheck by mutableStateOf(false)
        private set

    private var countdown: Job? = null

    fun choose(choice: Host) {
        getApplication<Application>().host = choice
        host = choice
    }

    fun connectDrive(auth: DriveAuth, switching: Boolean = false) = driveAttempt {
        if (switching) drive.disconnect(auth)
        drive.connect(auth)
    }

    fun disconnectDrive(auth: DriveAuth) = driveAttempt { drive.disconnect(auth) }

    fun setRetention(enabled: Boolean, days: Int) {
        drive.setRetention(enabled, days)
        autoDelete = drive.autoDelete
        retentionDays = drive.retentionDays
    }

    private fun driveAttempt(action: suspend () -> Unit) {
        driveBusy = true
        driveError = null
        viewModelScope.launch {
            try {
                action()
            } catch (e: DriveException) {
                // Closing Google's screen isn't an error worth a message.
                driveError = when (e.code) {
                    PlayDriveAuth.CANCELLED -> null
                    DriveClient.FAILED -> R.string.account_error_google
                    else -> driveMessage(e.code)
                }
            } finally {
                driveEmail = drive.email
                driveBusy = false
            }
        }
    }

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
        pendingGoogle = null
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

    fun startGoogle() {
        busy = true
        google = true
        error = null
    }

    fun onGoogle(outcome: GoogleSignIn.Outcome) {
        when (outcome) {
            is GoogleSignIn.Outcome.Token -> signInWithGoogle(outcome.idToken)
            GoogleSignIn.Outcome.Cancelled -> {
                busy = false
                google = false
            }
            GoogleSignIn.Outcome.Failed -> {
                busy = false
                google = false
                error = R.string.account_error_google
            }
        }
    }

    private fun signInWithGoogle(idToken: String) {
        pendingGoogle = idToken
        attempt {
            hosting.signInWithGoogle(idToken)
            pendingGoogle = null
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
                val idToken = pendingGoogle
                if (idToken != null) {
                    google = true
                    attempt {
                        hosting.rememberGuest(turnstile)
                        hosting.signInWithGoogle(idToken)
                        pendingGoogle = null
                        refresh()
                    }
                } else {
                    attempt {
                        hosting.rememberGuest(turnstile)
                        hosting.requestCode(email.trim(), Language.of(Locale.getDefault()))
                        sentTo = email.trim()
                        startCountdown()
                    }
                }
            },
            onFailure = { failure ->
                pendingGoogle = null
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
                if (e.code == RelayClient.GUEST_REQUIRED) {
                    needsCheck = true
                } else {
                    error = accountMessage(e.code)
                    pendingGoogle = null
                }
            } finally {
                busy = false
                google = false
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
