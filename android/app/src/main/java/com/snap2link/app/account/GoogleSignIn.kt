package com.snap2link.app.account

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

/**
 * "Continue with Google" through Android's Credential Manager. Google signs
 * the ID token for the project's Web client, which the relay accepts; the
 * Android client only tells Google that this app, with this key, may ask.
 */
object GoogleSignIn {
    /** Public by design: it names the client, it doesn't unlock anything. */
    private const val WEB_CLIENT_ID = "565416375675-r39tbd633anirdjvhj4el4kncmfeb1uq.apps.googleusercontent.com"

    sealed interface Outcome {
        data class Token(val idToken: String) : Outcome
        data object Cancelled : Outcome
        data object Failed : Outcome
    }

    /** Shows Google's account picker; [context] must belong to an activity. */
    suspend fun idToken(context: Context): Outcome {
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(WEB_CLIENT_ID).build())
            .build()
        return try {
            val credential = CredentialManager.create(context).getCredential(context, request).credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                Outcome.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            } else {
                Outcome.Failed
            }
        } catch (_: GetCredentialCancellationException) {
            Outcome.Cancelled
        } catch (_: NoCredentialException) {
            // No Google account on the phone, and none was added.
            Outcome.Failed
        } catch (e: GetCredentialException) {
            // The type says why (no Google account, app not registered, ...), never who.
            Log.w("Snap2Link", "Google sign-in failed: ${e.type}")
            Outcome.Failed
        } catch (_: GoogleIdTokenParsingException) {
            Outcome.Failed
        }
    }
}
