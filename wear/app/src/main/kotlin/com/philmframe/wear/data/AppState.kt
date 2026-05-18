package com.philmframe.wear.data

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * Single source of truth for the watch UI. Mirrors the useState() chain
 * from ReciprocityScreen.tsx.
 */
class AppState {
    var format by mutableStateOf("4x5")              // "4x5" | "120"
    var selectedStockIndex by mutableStateOf(0)
    var meteredSeconds by mutableStateOf(8.0)        // rotary-adjusted
    var deltaP by mutableStateOf(1.26)               // 1.26 | 1.20
    var customP by mutableStateOf(1.26)              // 1.00 - 1.60
    var activeFilters by mutableStateOf<Set<String>>(emptySet())
    var targetSeconds by mutableStateOf(0.0)         // for aperture calc; 0 = unused

    val stocks: List<FilmStock>
        get() = if (format == "4x5") FILM_STOCKS_4X5 else FILM_STOCKS_120

    /** Stock with dynamic P injected for Delta 100 and Custom. */
    val stock: FilmStock
        get() {
            val raw = stocks[selectedStockIndex.coerceIn(0, stocks.size - 1)]
            return when (raw.name) {
                "Delta 100" -> raw.copy(p = deltaP, source = "Ilford official (P=$deltaP)")
                "Custom" -> raw.copy(p = customP, source = "User defined (P=%.2f)".format(customP))
                else -> raw
            }
        }

    val adjusted: Double get() = calculateAdjusted(stock, meteredSeconds)
    val correctionStops: String get() = stopsCorrection(meteredSeconds, adjusted)

    fun toggleFilter(name: String) {
        activeFilters = if (name in activeFilters) activeFilters - name else activeFilters + name
    }

    fun nudgeMetered(delta: Double) {
        meteredSeconds = (meteredSeconds + delta).coerceIn(0.5, 1800.0)
    }

    fun nudgeCustomP(delta: Double) {
        customP = (customP + delta).coerceIn(1.00, 1.60)
        // Round to 2 decimal places (not truncate)
        customP = kotlin.math.round(customP * 100) / 100.0
    }
}

@Composable
fun rememberAppState(): AppState = remember { AppState() }
