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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.philmframe.wear.buzz.Buzz
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.computeApertureAdjustment
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.input.RotaryScrollable

/**
 * Aperture priority converter — enter desired actual exposure seconds,
 * output the new f-stop opening/closing from f/22 base, snapped to thirds.
 */
@Composable
fun AperturePriorityScreen(state: AppState) {
    val ctx = LocalContext.current
    // Seed target on first render to match the current corrected exposure
    LaunchedEffect(Unit) {
        if (state.targetSeconds == 0.0) state.targetSeconds = state.adjusted
    }

    val result = computeApertureAdjustment(state.adjusted, state.targetSeconds)
    val step = when {
        state.targetSeconds < 5 -> 0.5
        state.targetSeconds < 30 -> 1.0
        state.targetSeconds < 120 -> 5.0
        else -> 15.0
    }

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
        RotaryScrollable(
            onRotate = { delta ->
                state.targetSeconds = (state.targetSeconds + delta * step).coerceIn(0.5, 1800.0)
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
                Text(text = "APERTURE PRIORITY", style = PhilmType.labelMedium)

                // Target row with tap ± fallback
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(text = "TARGET EXPOSURE", style = PhilmType.labelMedium)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(PhilmSpacing.sm),
                    ) {
                        StepBtn(label = "−") {
                            state.targetSeconds = (state.targetSeconds - step).coerceIn(0.5, 1800.0)
                            Buzz.click(ctx)
                        }
                        Text(
                            text = formatTime(state.targetSeconds),
                            style = PhilmType.displayMedium,
                            modifier = Modifier.width(90.dp),
                        )
                        StepBtn(label = "+") {
                            state.targetSeconds = (state.targetSeconds + step).coerceIn(0.5, 1800.0)
                            Buzz.click(ctx)
                        }
                    }
                }

                // Result
                if (result != null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "${result.direction} %.1f stops".format(result.stopsDiff),
                            style = PhilmType.bodyMedium.copy(color = PhilmColors.accentDim),
                        )
                        Text(
                            text = "f/${formatFStop(result.nearestF)}",
                            style = PhilmType.displayLarge,
                        )
                        Text(text = "from f/22 base", style = PhilmType.bodySmall)
                    }
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "Set target to convert",
                            style = PhilmType.bodyMedium.copy(color = PhilmColors.accentDim),
                        )
                    }
                }
            }
        }
    }
}

private fun formatFStop(f: Double): String =
    if (f >= 10) "%.0f".format(f) else "%.1f".format(f)

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
