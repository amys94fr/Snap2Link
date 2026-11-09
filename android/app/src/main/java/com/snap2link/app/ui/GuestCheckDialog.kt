package com.snap2link.app.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import com.snap2link.app.R
import com.snap2link.app.relay.GuestCheck
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The relay's security check, once per phone: its `/guest` page in a web view
 * that can't go anywhere else. [onResult] gets the challenge token, or a
 * failure; dismissing the dialog counts as a cancellation.
 */
@Composable
fun GuestCheckDialog(onResult: (Result<String>) -> Unit) {
    val result by rememberUpdatedState(onResult)
    // The page and the dialog may both finish: only the first one counts.
    val done = remember { AtomicBoolean(false) }
    val finish: (Result<String>) -> Unit = {
        if (done.compareAndSet(false, true)) result(it)
    }

    Dialog(onDismissRequest = { finish(Result.failure(GuestCheck.Failed("cancelled"))) }) {
        Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainer) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(stringResource(R.string.guest_window_title), style = MaterialTheme.typography.titleLarge)
                Text(
                    stringResource(R.string.check_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                AndroidView(
                    modifier = Modifier.fillMaxWidth().height(90.dp),
                    factory = { context -> checkView(context, finish) },
                    onRelease = { it.destroy() },
                )
                TextButton(
                    onClick = { finish(Result.failure(GuestCheck.Failed("cancelled"))) },
                    modifier = Modifier.align(Alignment.End),
                ) {
                    Text(stringResource(R.string.account_delete_no))
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun checkView(context: android.content.Context, finish: (Result<String>) -> Unit): WebView =
    WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        setBackgroundColor(android.graphics.Color.TRANSPARENT)
        // Turnstile runs in a frame of its own domain.
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                return stop(request.url.toString())
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                // Some navigations skip the method above: stop them here.
                if (stop(url)) view.stopLoading()
            }

            /** Whether the web view must not load [url]. */
            private fun stop(url: String): Boolean = when (val step = GuestCheck.classify(url)) {
                GuestCheck.Step.Allow -> false
                GuestCheck.Step.Block -> true
                is GuestCheck.Step.Finish -> {
                    finish(step.result)
                    true
                }
            }
        }
        loadUrl(GuestCheck.page())
    }
