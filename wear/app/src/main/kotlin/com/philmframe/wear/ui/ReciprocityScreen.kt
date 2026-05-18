package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.philmframe.wear.buzz.Buzz
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.input.RotaryScrollable

/**
 * Primary calculator screen — main entry point.
 *
 * Layout (top → bottom on round screen):
 *   - TimeText (system clock, top)
 *   - Stock pill (tap → film picker)
 *   - Custom P stepper (only when "Custom" is selected)
 *   - Big corrected exposure + "+X.X stops"
 *   - Metered readout (rotary-adjusted)
 *   - START button
 *   - Vignette darkens edges to emphasize circular display
 *
 * Hardware:
 *   - Rotary input (digital bezel / crown gesture) → adjust metered seconds
 *   - Tap on screen anywhere not on a control → also adjusts metered (touch fallback for phones)
 *   - Quick Button (handled by MainActivity) → trigger countdown
 */
@Composable
fun ReciprocityScreen(
    state: AppState,
    onPickFilm: () -> Unit,
    onStartTimer: () -> Unit,
) {
    val ctx = LocalContext.current
    val stock = state.stock
    val isCustom = stock.name == "Custom"

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
        RotaryScrollable(
            onRotate = { delta ->
                val step = when {
                    state.meteredSeconds < 5 -> 0.5
                    state.meteredSeconds < 30 -> 1.0
                    state.meteredSeconds < 120 -> 5.0
                    state.meteredSeconds < 600 -> 15.0
                    else -> 60.0
                }
                state.nudgeMetered(delta * step)
                Buzz.click(ctx)
            },
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = PhilmSpacing.md, vertical = PhilmSpacing.lg),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceEvenly,
            ) {
                // Top: Stock pill — tap to change
                StockPill(
                    name = stock.name,
                    pValue = stock.p,
                    onClick = onPickFilm,
                )

                // Custom P stepper (only when Custom selected)
                if (isCustom) {
                    PStepper(
                        value = state.customP,
                        onDecrement = { state.nudgeCustomP(-it) },
                        onIncrement = { state.nudgeCustomP(it) },
                        onReset = { state.customP = 1.26 },
                    )
                }

                // Big corrected exposure — hero element
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(text = formatTime(state.adjusted), style = PhilmType.displayLarge)
                    Text(
                        text = "CORRECTED · ${state.correctionStops} STOPS",
                        style = PhilmType.bodySmall.copy(
                            color = PhilmColors.accentDim,
                            letterSpacing = 1.sp,
                        ),
                    )
                }

                // Metered readout — also doubles as tap target with ± for phones (no rotary)
                MeteredAdjuster(
                    seconds = state.meteredSeconds,
                    onChange = { delta ->
                        state.nudgeMetered(delta)
                        Buzz.click(ctx)
                    },
                )

                // Start button
                StartButton(onClick = onStartTimer)
            }
        }
    }
}

@Composable
private fun StockPill(name: String, pValue: Double?, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(PhilmRadius.full))
            .background(PhilmColors.surfaceElevated)
            .border(
                width = 1.dp,
                color = PhilmColors.border,
                shape = RoundedCornerShape(PhilmRadius.full),
            )
            .clickable { onClick() }
            .padding(horizontal = PhilmSpacing.md, vertical = PhilmSpacing.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = name,
                style = PhilmType.bodyMedium.copy(
                    color = PhilmColors.textPrimary,
                    fontWeight = FontWeight.W600,
                ),
            )
            if (pValue != null) {
                Spacer(modifier = Modifier.width(PhilmSpacing.xs))
                Text(
                    text = "P=%.2f".format(pValue),
                    style = PhilmType.bodySmall,
                )
            }
        }
    }
}

/**
 * METERED readout with tap-and-hold ± buttons on either side.
 * Touch fallback for devices without rotary input (phones during dev testing).
 */
@Composable
private fun MeteredAdjuster(seconds: Double, onChange: (Double) -> Unit) {
    val step = when {
        seconds < 5 -> 0.5
        seconds < 30 -> 1.0
        seconds < 120 -> 5.0
        seconds < 600 -> 15.0
        else -> 60.0
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PhilmSpacing.sm),
        ) {
            TouchStep(label = "−") { onChange(-step) }
            Text(
                text = formatTime(seconds),
                style = PhilmType.headlineLarge,
                modifier = Modifier.width(80.dp),
            )
            TouchStep(label = "+") { onChange(step) }
        }
        Text(
            text = "METERED",
            style = PhilmType.bodySmall.copy(
                color = PhilmColors.accentDim,
                letterSpacing = 1.sp,
            ),
        )
    }
}

@Composable
private fun TouchStep(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(RoundedCornerShape(PhilmRadius.full))
            .background(PhilmColors.surfaceElevated)
            .border(
                width = 1.dp,
                color = PhilmColors.border,
                shape = RoundedCornerShape(PhilmRadius.full),
            )
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = PhilmType.bodyMedium.copy(
                color = PhilmColors.textPrimary,
                fontWeight = FontWeight.W700,
            ),
        )
    }
}

@Composable
private fun StartButton(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(PhilmRadius.full))
            .background(PhilmColors.accent)
            .clickable { onClick() }
            .padding(horizontal = PhilmSpacing.lg, vertical = PhilmSpacing.xs),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Filled.PlayArrow,
                contentDescription = "Start",
                tint = PhilmColors.textInverse,
                modifier = Modifier.size(16.dp),
            )
            Spacer(modifier = Modifier.width(PhilmSpacing.xs))
            Text(
                text = "START",
                style = PhilmType.headlineMedium.copy(
                    color = PhilmColors.textInverse,
                    fontWeight = FontWeight.W700,
                ),
            )
        }
    }
}
