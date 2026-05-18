package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.philmframe.wear.buzz.Buzz
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.F_STOPS
import com.philmframe.wear.data.F_STOPS_INDEX_F22
import com.philmframe.wear.data.formatFStop
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.input.RotaryScrollable
import kotlin.math.abs
import kotlin.math.round

/**
 * Aperture Priority — pick a new f-stop, see the resulting exposure time.
 *
 * Reads the reciprocity-corrected baseline (state.adjusted) from the main
 * screen automatically — both screens share AppState. The user picks an
 * aperture different from f/22 and the screen computes:
 *
 *   newTime = baselineTime × 2^stopsFromF22
 *
 * where stopsFromF22 is exact thirds-of-a-stop from index position. Uses
 * 2^stops directly rather than the rounded (fNew/22)² ratio, which would
 * carry ~5.8% per-stop error from the conventional f-stop label rounding.
 *
 * Each ± tap moves the aperture by 1/3 stop along the standard third-stop
 * f-stop sequence (f/5.6 → f/64, 22 positions, baseline at index 12).
 *
 * Tapping the f-number in the center resets to f/22.
 * Tapping START fires a countdown using the aperture-adjusted time.
 */
@Composable
fun AperturePriorityScreen(
    state: AppState,
    onStartTimer: () -> Unit,
) {
    val ctx = LocalContext.current
    val density = LocalDensity.current.density
    val baseline = state.adjusted
    val newTime = state.apertureAdjustedSeconds
    val stops = state.apertureStopsFromBase

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
        RotaryScrollable(
            onRotate = { delta ->
                // Rotary emits a Float delta — for an integer-step UI we just
                // care about direction: each tick = ±1 third-stop position.
                val step = if (delta > 0f) 1 else -1
                state.nudgeAperture(step)
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
                // Hero: new exposure time
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = formatTime(newTime),
                        style = PhilmType.displayLarge,
                    )
                    Text(
                        text = stopsLabel(stops),
                        style = PhilmType.bodySmall.copy(color = PhilmColors.accentDim),
                    )
                }

                // Aperture stepper
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(PhilmSpacing.sm),
                    ) {
                        StepBtn(label = "−") {
                            state.nudgeAperture(-1)
                            Buzz.click(ctx)
                        }
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(PhilmRadius.full))
                                .background(PhilmColors.accentSubtle)
                                .border(
                                    width = 1.dp,
                                    color = PhilmColors.accent,
                                    shape = RoundedCornerShape(PhilmRadius.full),
                                )
                                .pointerInput(Unit) {
                                    // Drag vertically on the f-stop pill to step through
                                    // third-stop positions. Drag up = stop down (smaller
                                    // aperture, more time). Drag down = stop up (wider,
                                    // less time). Backup input for Galaxy Watch Ultra.
                                    var accum = 0f
                                    detectVerticalDragGestures(
                                        onDragStart = { accum = 0f },
                                        onDragEnd = { accum = 0f },
                                    ) { _, dragAmount ->
                                        accum += -dragAmount
                                        val threshold = 14f * density
                                        while (accum >= threshold) {
                                            state.nudgeAperture(1)
                                            Buzz.click(ctx)
                                            accum -= threshold
                                        }
                                        while (accum <= -threshold) {
                                            state.nudgeAperture(-1)
                                            Buzz.click(ctx)
                                            accum += threshold
                                        }
                                    }
                                }
                                .clickable {
                                    state.resetAperture()
                                    Buzz.click(ctx)
                                }
                                .padding(horizontal = PhilmSpacing.md, vertical = PhilmSpacing.xs),
                        ) {
                            Text(
                                text = "f/${formatFStop(state.currentFStop)}",
                                style = PhilmType.headlineLarge.copy(
                                    color = PhilmColors.accent,
                                    fontWeight = FontWeight.W700,
                                ),
                            )
                        }
                        StepBtn(label = "+") {
                            state.nudgeAperture(1)
                            Buzz.click(ctx)
                        }
                    }
                    Spacer(modifier = Modifier.height(PhilmSpacing.xs))
                    Text(
                        text = "baseline ${formatTime(baseline)} @ f/22",
                        style = PhilmType.bodySmall,
                    )
                }

                // Start button
                StartButton(onClick = onStartTimer)
            }
        }
    }
}

private fun stopsLabel(stops: Double): String {
    val rounded = round(stops * 10) / 10.0  // 1 decimal
    return when {
        abs(rounded) < 0.05 -> "at f/22 baseline"
        rounded > 0 -> "↑ close ${"%.1f".format(rounded)} ${stopText(rounded)}"
        else -> "↓ open ${"%.1f".format(abs(rounded))} ${stopText(rounded)}"
    }
}

private fun stopText(stops: Double): String =
    if (abs(stops) < 1.05 && abs(stops) > 0.95) "stop" else "stops"

@Composable
private fun StepBtn(label: String, onClick: () -> Unit) {
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
