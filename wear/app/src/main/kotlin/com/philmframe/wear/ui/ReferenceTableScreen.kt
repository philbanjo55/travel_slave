package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.calculateAdjusted
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.data.stopsCorrection

/**
 * Reference table — preview adjusted exposures at standard metered times
 * for the currently selected stock. Compresses the RN reference table.
 */
@Composable
fun ReferenceTableScreen(state: AppState) {
    val stock = state.stock
    val listState = rememberScalingLazyListState()
    val rows = listOf(1.0, 2.0, 4.0, 8.0, 15.0, 30.0, 60.0, 120.0, 240.0, 600.0)

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
        item {
            Text(
                text = stock.name.uppercase(),
                style = PhilmType.labelMedium,
            )
        }
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = PhilmSpacing.md),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(text = "Metered", style = PhilmType.bodySmall, modifier = Modifier.weight(1f))
                Text(text = "→", style = PhilmType.bodySmall, modifier = Modifier.weight(0.3f))
                Text(text = "Adjusted", style = PhilmType.bodySmall, modifier = Modifier.weight(1f))
                Text(text = "Stops", style = PhilmType.bodySmall, modifier = Modifier.weight(0.7f))
            }
        }
        items(rows) { metered ->
            val adj = calculateAdjusted(stock, metered)
            val stops = stopsCorrection(metered, adj)
            val isCurrent = kotlin.math.abs(metered - state.meteredSeconds) < 0.5
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (isCurrent) PhilmColors.accentSubtle else PhilmColors.background)
                    .padding(horizontal = PhilmSpacing.md, vertical = 4.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = formatTime(metered),
                        style = PhilmType.bodyMedium.copy(
                            color = if (isCurrent) PhilmColors.accent else PhilmColors.textSecondary,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    Text(text = "→", style = PhilmType.bodySmall, modifier = Modifier.weight(0.3f))
                    Text(
                        text = formatTime(adj),
                        style = PhilmType.bodyMedium.copy(
                            color = if (isCurrent) PhilmColors.accent else PhilmColors.textPrimary,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = stops,
                        style = PhilmType.bodySmall.copy(
                            color = if (isCurrent) PhilmColors.accent else PhilmColors.textTertiary,
                        ),
                        modifier = Modifier.weight(0.7f),
                    )
                }
            }
        }
        }
    }
}
