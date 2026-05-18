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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Text
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.FILTERS
import com.philmframe.wear.data.filterFactor
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.data.totalFilterStops

/**
 * Filter stack picker. Tap to toggle. Running total at top.
 * Combined factor applied to metered time = preview shown.
 */
@Composable
fun FilterStackScreen(state: AppState) {
    val active = state.activeFilters
    val listState = rememberScalingLazyListState()
    val total = totalFilterStops(active)
    val factor = filterFactor(active)

    ScalingLazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(PhilmSpacing.xs),
    ) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = "FILTER STACK", style = PhilmType.labelMedium)
                if (active.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(PhilmSpacing.xs))
                    Text(
                        text = "+%.1f stops".format(total),
                        style = PhilmType.headlineLarge,
                    )
                    Text(
                        text = "${"%.0f".format(factor)}× factor",
                        style = PhilmType.bodySmall,
                    )
                    if (state.meteredSeconds > 0) {
                        Text(
                            text = "${formatTime(state.meteredSeconds)} → ${formatTime(state.meteredSeconds * factor)}",
                            style = PhilmType.bodyMedium.copy(color = PhilmColors.accentDim),
                        )
                    }
                }
            }
        }

        items(FILTERS) { f ->
            val on = f.name in active
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(PhilmRadius.md))
                    .background(if (on) PhilmColors.accentSubtle else PhilmColors.surface)
                    .border(
                        width = if (on) 1.dp else 0.dp,
                        color = if (on) PhilmColors.accent else PhilmColors.borderSubtle,
                        shape = RoundedCornerShape(PhilmRadius.md),
                    )
                    .clickable { state.toggleFilter(f.name) }
                    .padding(horizontal = PhilmSpacing.md, vertical = PhilmSpacing.sm),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = f.name,
                        style = PhilmType.bodyMedium.copy(
                            color = PhilmColors.textPrimary,
                            fontWeight = if (on) FontWeight.W700 else FontWeight.W400,
                        ),
                    )
                    Text(
                        text = "+%.0f".format(f.stops),
                        style = PhilmType.bodyMedium.copy(color = PhilmColors.accentDim),
                    )
                }
            }
        }
    }
}
