package com.snap2link.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// The site's slate and the orange of the icon. On the orange, text is dark in
// dark mode and white in light mode, which keeps both above 4.5:1.
private val Dark = darkColorScheme(
    primary = Color(0xFFE8916F),
    onPrimary = Color(0xFF2A1208),
    primaryContainer = Color(0xFF5A2A18),
    onPrimaryContainer = Color(0xFFFFDBCF),
    secondaryContainer = Color(0xFF5A2A18),
    onSecondaryContainer = Color(0xFFFFDBCF),
    background = Color(0xFF0F172A),
    onBackground = Color(0xFFF1F5F9),
    surface = Color(0xFF0F172A),
    onSurface = Color(0xFFF1F5F9),
    surfaceContainer = Color(0xFF1E293B),
    surfaceContainerHigh = Color(0xFF243247),
    surfaceContainerHighest = Color(0xFF2B3A52),
    onSurfaceVariant = Color(0xFFCBD5E1),
    outline = Color(0xFF475569),
    outlineVariant = Color(0xFF334155),
    error = Color(0xFFFCA5A5),
    onError = Color(0xFF450A0A),
)

private val Light = lightColorScheme(
    primary = Color(0xFFB4532F),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFFFDBCF),
    onPrimaryContainer = Color(0xFF3A1406),
    secondaryContainer = Color(0xFFFFDBCF),
    onSecondaryContainer = Color(0xFF3A1406),
    background = Color(0xFFF8FAFC),
    onBackground = Color(0xFF0F172A),
    surface = Color(0xFFF8FAFC),
    onSurface = Color(0xFF0F172A),
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerHigh = Color(0xFFF1F5F9),
    surfaceContainerHighest = Color(0xFFE2E8F0),
    onSurfaceVariant = Color(0xFF475569),
    outline = Color(0xFF94A3B8),
    outlineVariant = Color(0xFFE2E8F0),
    error = Color(0xFFB91C1C),
    onError = Color(0xFFFFFFFF),
)

/** The green of "0 files saved" on the site, readable on both backgrounds. */
val Success: Color
    @Composable get() = if (isSystemInDarkTheme()) Color(0xFF86EFAC) else Color(0xFF15803D)

@Composable
fun Snap2LinkTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
