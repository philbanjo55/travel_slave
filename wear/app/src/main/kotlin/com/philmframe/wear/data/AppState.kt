package com.philmframe.wear.data

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlin.math.pow

/**
 * Single source of truth for the watch UI. Mirrors the useState() chain
 * from ReciprocityScreen.tsx.
 */
class AppState {
    var format by mutableStateOf("4x5")              // "4x5" | "120"
    var selectedStockIndex by mutableStateOf(0)
    var meteredSeconds by mutableStateOf(8.0)        // rotary-adjusted
    var deltaP by mutableStateOf(1.20)               // Phil's calibrated Delta 100 (Praus + Imacon)
    var customP by mutableStateOf(1.26)              // 1.00 - 1.60
    var activeFilters by mutableStateOf<Set<String>>(emptySet())
    var targetSeconds by mutableStateOf(0.0)         // legacy aperture calc; 0 = unused
    var apertureFStopIndex by mutableStateOf(F_STOPS_INDEX_F22) // 12 = f/22 baseline

    val stocks: List<FilmStock>
        get() = if (format == "4x5") FILM_STOCKS_4X5 else FILM_STOCKS_120

    /** Stock with dynamic P injected for Delta 100 and Custom. */
    val stock: FilmStock
        get() {
            val raw = stocks[selectedStockIndex.coerceIn(0, stocks.size - 1)]
            return when (raw.name) {
                "Delta 100" -> raw.copy(p = deltaP, source = "Phil calibrated (P=$deltaP)")
                "Custom" -> raw.copy(p = customP, source = "User defined (P=%.2f)".format(customP))
                else -> raw
            }
        }

    val adjusted: Double get() = calculateAdjusted(stock, meteredSeconds)
    val correctionStops: String get() = stopsCorrection(meteredSeconds, adjusted)

    /** Current f-stop (e.g. f/22 = 22.0). */
    val currentFStop: Double get() = F_STOPS[apertureFStopIndex.coerceIn(0, F_STOPS.size - 1)]

    /** Stops away from f/22 baseline (positive = closed down, more time needed). */
    val apertureStopsFromBase: Double
        get() = (apertureFStopIndex - F_STOPS_INDEX_F22) / 3.0

    /**
     * Exposure time at the selected aperture, derived from the reciprocity-corrected f/22 time.
     *
     * Uses exact 2^stops (one full stop = 2x time) rather than (fNew/fOld)^2 with the
     * rounded f-stop labels. The labels 16/22/32 are conventional shorthand for the
     * irrational values 16/22.627/32, and using the labels directly introduces a ~5.8%
     * over-estimate per stop. apertureStopsFromBase already gives exact thirds-of-a-stop
     * from the index, so 2^stops gives the physically correct time relationship — matching
     * what the lens mechanism actually does when you click between f-stops.
     *
     * Sanity check at f/32 (one stop closed from f/22) with 12s baseline:
     *   2^stops formula:        12 × 2.000 = 24.00s  ✓ exact one stop
     *   (32/22)^2 formula:      12 × 2.116 = 25.40s  ✗ +5.8% high
     */
    val apertureAdjustedSeconds: Double
        get() = adjusted * 2.0.pow(apertureStopsFromBase)

    fun toggleFilter(name: String) {
        activeFilters = if (name in activeFilters) activeFilters - name else activeFilters + name
    }

    fun nudgeMetered(delta: Double) {
        meteredSeconds = (meteredSeconds + delta).coerceIn(1.0, 1800.0)
    }

    fun nudgeAperture(steps: Int) {
        apertureFStopIndex = (apertureFStopIndex + steps).coerceIn(0, F_STOPS.size - 1)
    }

    fun resetAperture() {
        apertureFStopIndex = F_STOPS_INDEX_F22
    }

    fun nudgeCustomP(delta: Double) {
        customP = (customP + delta).coerceIn(1.00, 1.60)
        // Round to 2 decimal places (not truncate)
        customP = kotlin.math.round(customP * 100) / 100.0
    }
}

@Composable
fun rememberAppState(): AppState = remember { AppState() }
