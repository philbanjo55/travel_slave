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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.philmframe.wear.data.AppState
import com.philmframe.wear.data.FILM_STOCKS_120
import com.philmframe.wear.data.FILM_STOCKS_4X5
import com.philmframe.wear.data.FilmStock
import com.philmframe.wear.data.Method

/**
 * Film stock selector. Format toggle at top (4x5 / 120), then scrolling list.
 * Tap a stock → applies + returns. Swipe right to dismiss.
 */
@Composable
fun FilmPickerScreen(
    state: AppState,
    onDismiss: () -> Unit,
) {
    val stocks = if (state.format == "4x5") FILM_STOCKS_4X5 else FILM_STOCKS_120
    val listState = rememberScalingLazyListState()

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(PhilmSpacing.xs),
        ) {
        // Format toggle at top
        item {
            Row(
                horizontalArrangement = Arrangement.spacedBy(PhilmSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FormatPill(label = "4x5", active = state.format == "4x5") {
                    state.format = "4x5"
                    state.selectedStockIndex = 0
                }
                FormatPill(label = "120", active = state.format == "120") {
                    state.format = "120"
                    state.selectedStockIndex = 0
                }
            }
        }

        items(stocks) { stock ->
            val index = stocks.indexOf(stock)
            val selected = state.selectedStockIndex == index
            StockRow(
                stock = stock,
                selected = selected,
                effectiveP = when (stock.name) {
                    "Delta 100" -> state.deltaP
                    "Custom" -> state.customP
                    else -> stock.p
                },
                onTap = {
                    state.selectedStockIndex = index
                    onDismiss()
                },
            )
        }

        // Back row
        item {
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(PhilmColors.surface)
                    .clickable { onDismiss() }
                    .padding(PhilmSpacing.sm),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = PhilmColors.textPrimary,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
        }
    }
}

@Composable
private fun FormatPill(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(PhilmRadius.full))
            .background(if (active) PhilmColors.accent else PhilmColors.surface)
            .border(
                width = 1.dp,
                color = PhilmColors.border,
                shape = RoundedCornerShape(PhilmRadius.full),
            )
            .clickable { onClick() }
            .padding(horizontal = PhilmSpacing.md, vertical = PhilmSpacing.xs),
    ) {
        Text(
            text = label,
            style = PhilmType.bodyMedium.copy(
                color = if (active) PhilmColors.textInverse else PhilmColors.textPrimary,
                fontWeight = FontWeight.W700,
            ),
        )
    }
}

@Composable
private fun StockRow(
    stock: FilmStock,
    selected: Boolean,
    effectiveP: Double?,
    onTap: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PhilmRadius.md))
            .background(if (selected) PhilmColors.accentSubtle else PhilmColors.surface)
            .border(
                width = if (selected) 1.dp else 0.dp,
                color = if (selected) PhilmColors.accent else PhilmColors.borderSubtle,
                shape = RoundedCornerShape(PhilmRadius.md),
            )
            .clickable { onTap() }
            .padding(horizontal = PhilmSpacing.md, vertical = PhilmSpacing.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stock.name,
                    style = PhilmType.bodyMedium.copy(
                        color = PhilmColors.textPrimary,
                        fontWeight = FontWeight.W600,
                    ),
                )
                Text(
                    text = subtextFor(stock, effectiveP),
                    style = PhilmType.bodySmall,
                )
            }
            if (selected) {
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = "Selected",
                    tint = PhilmColors.accent,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}

private fun subtextFor(stock: FilmStock, effectiveP: Double?): String = when {
    stock.method == Method.POWER && effectiveP != null -> "P=%.2f".format(effectiveP)
    stock.method == Method.LOOKUP -> "lookup"
    stock.method == Method.PROVIA -> "no corr <128s"
    stock.method == Method.PORTRA -> "community curve"
    else -> ""
}
