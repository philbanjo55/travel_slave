package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Text
import com.philmframe.wear.buzz.Buzz
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.computeApertureAdjustment
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.input.RotaryScrollable

/**
 * Aperture priority converter. Initial target = current adjusted value;
 * rotary nudges target down (you want a SHORTER actual exposure → close stops).
 * Output: new f-stop value snapped to thirds, plus direction.
 */
@Composable
fun AperturePriorityScreen(state: AppState) {
    val ctx = LocalContext.current
    // Use current adjusted as starting target if user hasn't set anything
    if (state.targetSeconds == 0.0) {
        state.targetSeconds = state.adjusted
    }

    val result = computeApertureAdjustment(state.adjusted, state.targetSeconds)

    RotaryScrollable(
        onRotate = { delta ->
            val step = when {
                state.targetSeconds < 5 -> 0.5
                state.targetSeconds < 30 -> 1.0
                state.targetSeconds < 120 -> 5.0
                else -> 15.0
            }
            state.targetSeconds = (state.targetSeconds + delta * step).coerceIn(0.5, 1800.0)
            Buzz.click(ctx)
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = PhilmSpacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(text = "APERTURE PRIORITY", style = PhilmType.labelMedium)
            Spacer(modifier = Modifier.height(PhilmSpacing.md))

            // Target row
            Text(text = "TARGET EXPOSURE", style = PhilmType.labelMedium)
            Text(text = formatTime(state.targetSeconds), style = PhilmType.displayMedium)
            Spacer(modifier = Modifier.height(PhilmSpacing.md))

            // Result
            if (result != null) {
                Text(
                    text = "${result.direction} %.1f stops".format(result.stopsDiff),
                    style = PhilmType.bodyMedium.copy(color = PhilmColors.accentDim),
                )
                Text(
                    text = "f/%s".format(
                        if (result.nearestF >= 10) "%.0f".format(result.nearestF)
                        else "%.1f".format(result.nearestF),
                    ),
                    style = PhilmType.displayLarge,
                )
                Text(
                    text = "from f/22 base",
                    style = PhilmType.bodySmall,
                )
            } else {
                Text(
                    text = "No adjustment needed",
                    style = PhilmType.bodyMedium.copy(color = PhilmColors.accentDim),
                )
                Text(
                    text = "rotate to set target",
                    style = PhilmType.bodySmall,
                )
            }
        }
    }
}
