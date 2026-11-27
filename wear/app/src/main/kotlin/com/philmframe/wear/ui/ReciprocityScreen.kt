package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
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
            // Re-request focus every time the metered value changes — this means
            // after any tap on a child button, the next state change pulls focus
            // back to the rotary Box. Without this, the first tap permanently
            // steals rotary focus.
            focusKey = state.meteredSeconds,
            onRotate = { delta ->
                // Each rotary tick = ±1 second, regardless of current value.
                // No adaptive acceleration — Phil wants predictable single-unit stepping.
                val step = if (delta > 0f) 1.0 else -1.0
                state.nudgeMetered(step)
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
    // Fixed step sizes, regardless of current value:
    //   - Single tap   = ±1 second
    //   - Long press   = ±5 seconds
    //   - Drag time number vertically = ±1 second per ~12dp
    // No adaptive acceleration — Phil wants predictable stepping.
    val ctx = LocalContext.current
    val density = LocalDensity.current.density
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PhilmSpacing.sm),
        ) {
            TouchStep(
                label = "−",
                onTap = { onChange(-1.0) },
                onLongPress = { onChange(-5.0) },
            )
            // Time number — also acts as a drag handle. Drag up = +1s per ~12dp,
            // drag down = -1s per ~12dp. Backup input in case rotary doesn't
            // register on Galaxy Watch Ultra (no physical bezel/crown).
            Text(
                text = formatTime(seconds),
                style = PhilmType.headlineLarge,
                modifier = Modifier
                    .width(80.dp)
                    .pointerInput(Unit) {
                        var accum = 0f
                        detectVerticalDragGestures(
                            onDragStart = { accum = 0f },
                            onDragEnd = { accum = 0f },
                        ) { _, dragAmount ->
                            // Drag UP (negative dragAmount in Compose Y) = increase
                            accum += -dragAmount
                            val threshold = 12f * density
                            while (accum >= threshold) {
                                onChange(1.0)
                                Buzz.click(ctx)
                                accum -= threshold
                            }
                            while (accum <= -threshold) {
                                onChange(-1.0)
                                Buzz.click(ctx)
                                accum += threshold
                            }
                        }
                    },
            )
            TouchStep(
                label = "+",
                onTap = { onChange(1.0) },
                onLongPress = { onChange(5.0) },
            )
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
private fun TouchStep(label: String, onTap: () -> Unit, onLongPress: () -> Unit) {
    val ctx = LocalContext.current
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
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = {
                        onTap()
                        Buzz.click(ctx)
                    },
                    onLongPress = {
                        onLongPress()
                        Buzz.tick(ctx)
                    },
                )
            },
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
