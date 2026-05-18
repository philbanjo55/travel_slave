package com.philmframe.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Typography

/**
 * Philm+Frame design system, ported from src/theme.ts (RN app).
 * Pure black & white, minimal, Georgia for display text.
 */
object PhilmColors {
    val background = Color(0xFF000000)
    val surface = Color(0xFF111111)
    val surfaceElevated = Color(0xFF1A1A1A)
    val border = Color(0xFF2A2A2A)
    val borderSubtle = Color(0xFF1A1A1A)

    val accent = Color(0xFFFFFFFF)
    val accentDim = Color(0xFF888888)
    val accentSubtle = Color(0x14FFFFFF) // rgba(255,255,255,0.08)

    val textPrimary = Color(0xFFFFFFFF)
    val textSecondary = Color(0xFF888888)
    val textTertiary = Color(0xFF444444)
    val textInverse = Color(0xFF000000)

    val signalOk = Color(0xFF5AAA7A)
    val signalWarning = Color(0xFFAAAAAA)
}

object PhilmSpacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
}

object PhilmRadius {
    val sm = 6.dp
    val md = 10.dp
    val lg = 16.dp
    val full = 999.dp
}

// Georgia isn't on Wear OS by default — fall back to serif which renders similarly
private val DisplayFont = FontFamily.Serif

object PhilmType {
    val displayLarge = TextStyle(
        fontFamily = DisplayFont,
        fontSize = 28.sp,
        fontWeight = FontWeight.W400,
        letterSpacing = 0.5.sp,
        color = PhilmColors.textPrimary,
    )
    val displayMedium = TextStyle(
        fontFamily = DisplayFont,
        fontSize = 22.sp,
        fontWeight = FontWeight.W400,
        letterSpacing = 0.3.sp,
        color = PhilmColors.textPrimary,
    )
    val headlineLarge = TextStyle(
        fontSize = 18.sp,
        fontWeight = FontWeight.W600,
        letterSpacing = 0.2.sp,
        color = PhilmColors.textPrimary,
    )
    val headlineMedium = TextStyle(
        fontSize = 15.sp,
        fontWeight = FontWeight.W600,
        color = PhilmColors.textPrimary,
    )
    val bodyLarge = TextStyle(
        fontSize = 15.sp,
        fontWeight = FontWeight.W400,
        color = PhilmColors.textPrimary,
    )
    val bodyMedium = TextStyle(
        fontSize = 13.sp,
        fontWeight = FontWeight.W400,
        color = PhilmColors.textSecondary,
    )
    val bodySmall = TextStyle(
        fontSize = 11.sp,
        fontWeight = FontWeight.W400,
        color = PhilmColors.textTertiary,
    )
    val labelLarge = TextStyle(
        fontSize = 11.sp,
        fontWeight = FontWeight.W700,
        letterSpacing = 1.4.sp,
        color = PhilmColors.textTertiary,
    )
    val labelMedium = TextStyle(
        fontSize = 10.sp,
        fontWeight = FontWeight.W700,
        letterSpacing = 1.2.sp,
        color = PhilmColors.textTertiary,
    )
    val timer = TextStyle(
        fontFamily = DisplayFont,
        fontSize = 56.sp,
        fontWeight = FontWeight.W400,
        color = PhilmColors.textPrimary,
    )
    val countdown = TextStyle(
        fontFamily = DisplayFont,
        fontSize = 80.sp,
        fontWeight = FontWeight.W400,
        color = PhilmColors.textPrimary,
    )
}

private val PhilmWearColors = Colors(
    primary = PhilmColors.accent,
    primaryVariant = PhilmColors.accent,
    secondary = PhilmColors.accent,
    secondaryVariant = PhilmColors.accentDim,
    background = PhilmColors.background,
    surface = PhilmColors.surface,
    error = PhilmColors.signalWarning,
    onPrimary = PhilmColors.textInverse,
    onSecondary = PhilmColors.textInverse,
    onBackground = PhilmColors.textPrimary,
    onSurface = PhilmColors.textPrimary,
    onSurfaceVariant = PhilmColors.textSecondary,
    onError = PhilmColors.textInverse,
)

@Composable
fun PhilmTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = PhilmWearColors,
        typography = Typography(
            display1 = PhilmType.displayLarge,
            display2 = PhilmType.displayMedium,
            display3 = PhilmType.headlineLarge,
            title1 = PhilmType.headlineLarge,
            title2 = PhilmType.headlineMedium,
            title3 = PhilmType.headlineMedium,
            body1 = PhilmType.bodyLarge,
            body2 = PhilmType.bodyMedium,
            caption1 = PhilmType.bodySmall,
            caption2 = PhilmType.labelMedium,
            caption3 = PhilmType.labelMedium,
        ),
        content = content,
    )
}
