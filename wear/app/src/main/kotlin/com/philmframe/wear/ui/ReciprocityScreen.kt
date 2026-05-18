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
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Text
import com.philmframe.wear.buzz.Buzz
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.input.RotaryScrollable

/**
 * Primary calculator screen. Rotary adjusts metered seconds; tap film pill to swap stock;
 * tap START (or press Quick Button — handled in MainActivity) to begin countdown.
 */
@Composable
fun ReciprocityScreen(
    state: AppState,
    onPickFilm: () -> Unit,
    onStartTimer: () -> Unit,
) {
    val ctx = LocalContext.current
    val stock = state.stock

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
                .padding(horizontal = PhilmSpacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Spacer(modifier = Modifier.height(PhilmSpacing.lg))

            // Stock pill — tap to change
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(PhilmRadius.full))
                    .background(PhilmColors.surfaceElevated)
                    .border(
                        width = 1.dp,
                        color = PhilmColors.border,
                        shape = RoundedCornerShape(PhilmRadius.full),
                    )
                    .clickable { onPickFilm() }
                    .padding(horizontal = PhilmSpacing.md, vertical = PhilmSpacing.xs),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = stock.name,
                        style = PhilmType.bodyMedium.copy(
                            color = PhilmColors.textPrimary,
                            fontWeight = FontWeight.W600,
                        ),
                    )
                    if (stock.p != null) {
                        Spacer(modifier = Modifier.width(PhilmSpacing.xs))
                        Text(text = "P=%.2f".format(stock.p), style = PhilmType.bodySmall)
                    }
                }
            }

            // Big corrected exposure
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = "CORRECTED", style = PhilmType.labelMedium)
                Text(text = formatTime(state.adjusted), style = PhilmType.displayLarge)
                Text(
                    text = "${state.correctionStops} stops",
                    style = PhilmType.bodyMedium.copy(color = PhilmColors.accentDim),
                )
            }

            // Metered readout
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = "METERED", style = PhilmType.labelMedium)
                Text(text = formatTime(state.meteredSeconds), style = PhilmType.headlineLarge)
            }

            // Start button
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(PhilmRadius.full))
                    .background(PhilmColors.accent)
                    .clickable { onStartTimer() }
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

            Spacer(modifier = Modifier.height(PhilmSpacing.sm))
        }
    }
}
