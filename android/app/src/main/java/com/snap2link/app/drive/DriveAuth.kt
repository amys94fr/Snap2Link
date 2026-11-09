package com.snap2link.app.drive

import android.accounts.Account
import android.app.Activity
import androidx.activity.ComponentActivity
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import java.util.UUID
import kotlin.coroutines.resume

/** Where Drive access tokens come from: Play services, or a fake in tests. */
interface DriveAuth {
    /** A fresh access token, asking the person first when Android needs to. */
    suspend fun token(): String

    /** Forgets a token Drive refused, so that the next one is new. */
    suspend fun clear(token: String)

    /** Withdraws the app's access to this account's Drive. */
    suspend fun revoke(email: String)
}

/**
 * The `drive.file` permission, asked through Play services: the person picks
 * an account and agrees once, then tokens come without a screen. [interactive]
 * false never shows one, for work the person didn't start.
 */
class PlayDriveAuth(
    private val activity: ComponentActivity,
    private val interactive: Boolean = true,
) : DriveAuth {
    private val client get() = Identity.getAuthorizationClient(activity)

    override suspend fun token(): String {
        val request = AuthorizationRequest.builder().setRequestedScopes(SCOPES).build()
        val result = try {
            client.authorize(request).await()
        } catch (_: ApiException) {
            // Play services refused: no Google account, or this app isn't registered with Google.
            throw DriveException(DriveClient.FAILED)
        }
        val granted = if (result.hasResolution()) {
            if (!interactive) throw DriveException(NOT_CONNECTED)
            consent(result) ?: throw DriveException(CANCELLED)
        } else {
            result
        }
        return granted.accessToken ?: throw DriveException(NOT_CONNECTED)
    }

    override suspend fun clear(token: String) {
        try {
            client.clearToken(ClearTokenRequest.builder().setToken(token).build()).await()
        } catch (_: ApiException) {
            // The next request still works; at worst it gets the same token.
        }
    }

    override suspend fun revoke(email: String) {
        try {
            val request = RevokeAccessRequest.builder()
                .setAccount(Account(email, "com.google"))
                .setScopes(SCOPES)
                .build()
            client.revokeAccess(request).await()
        } catch (_: ApiException) {
            // Signed out here all the same: the person can also revoke from their Google account.
        }
    }

    /** Shows Google's consent screen and waits for the answer. */
    private suspend fun consent(result: AuthorizationResult): AuthorizationResult? {
        val pending = result.pendingIntent ?: return null
        return suspendCancellableCoroutine { continuation ->
            val launcher = activity.activityResultRegistry.register(
                "drive-${UUID.randomUUID()}",
                ActivityResultContracts.StartIntentSenderForResult(),
            ) { answer ->
                val granted = if (answer.resultCode == Activity.RESULT_OK) {
                    try {
                        client.getAuthorizationResultFromIntent(answer.data)
                    } catch (_: ApiException) {
                        null
                    }
                } else {
                    null
                }
                if (continuation.isActive) continuation.resume(granted)
            }
            continuation.invokeOnCancellation { launcher.unregister() }
            launcher.launch(IntentSenderRequest.Builder(pending.intentSender).build())
        }
    }

    companion object {
        const val NOT_CONNECTED = "not_connected"
        const val CANCELLED = "cancelled"

        /** The files this app creates, and the address to show which account it is. */
        val SCOPES = listOf(Scope("https://www.googleapis.com/auth/drive.file"), Scope("email"))
    }
}
