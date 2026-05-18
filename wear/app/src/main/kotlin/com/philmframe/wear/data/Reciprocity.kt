package com.philmframe.wear.data

import kotlin.math.ln
import kotlin.math.log2
import kotlin.math.pow
import kotlin.math.round

/**
 * Direct port of the reciprocity engine from src/screens/ReciprocityScreen.tsx.
 * Math must match exactly so watch and phone produce identical results.
 */

enum class Method { POWER, LOOKUP, PORTRA, PROVIA }

data class FilmStock(
    val name: String,
    val method: Method,
    val p: Double? = null,
    val data: List<Pair<Double, Double>>? = null,
    val source: String,
    val note: String? = null,
)

// Kodak lookup tables (from official data sheets)
private val TRIX_DATA = listOf(1.0 to 2.0, 10.0 to 50.0, 100.0 to 1200.0)
private val TMY_DATA = listOf(1.0 to 1.0, 10.0 to 15.0, 100.0 to 200.0, 240.0 to 540.0)

val FILM_STOCKS_4X5 = listOf(
    FilmStock("Delta 100", Method.POWER, p = 1.26, source = "Ilford official PDF"),
    FilmStock("FP4+", Method.POWER, p = 1.26, source = "Ilford official PDF"),
    FilmStock("Pan F+ 50", Method.POWER, p = 1.26,
        source = "HARMAN 4x5 launch May 2026 · Bond/Roos field",
        note = "3-mo latent image — develop within weeks"),
    FilmStock("HP5+", Method.POWER, p = 1.31, source = "Ilford official PDF"),
    FilmStock("T-Max 400", Method.LOOKUP, data = TMY_DATA, source = "Kodak F-4016 + Bond"),
    FilmStock("T-Max 100", Method.POWER, p = 1.15, source = "Kodak F-4016"),
    FilmStock("Tri-X 320", Method.LOOKUP, data = TRIX_DATA, source = "Kodak F-4017"),
    FilmStock("Provia 100F", Method.PROVIA, source = "Fuji data sheet",
        note = "No correction up to 128s"),
    FilmStock("Portra 160", Method.PORTRA, source = "Sachs/community R²=0.995"),
    FilmStock("Portra 400", Method.PORTRA, source = "Same curve as 160"),
    FilmStock("Custom", Method.POWER, p = 1.26,
        source = "User defined — field testing",
        note = "Rotary adjusts P value"),
)

val FILM_STOCKS_120 = listOf(
    FilmStock("SFX 200", Method.POWER, p = 1.43, source = "Ilford official PDF"),
    FilmStock("Tri-X 400", Method.LOOKUP, data = TRIX_DATA, source = "Kodak F-4017"),
    FilmStock("T-Max 400", Method.LOOKUP, data = TMY_DATA, source = "Kodak F-4016 + Bond"),
    FilmStock("T-Max 100", Method.POWER, p = 1.15, source = "Kodak F-4016"),
    FilmStock("Custom", Method.POWER, p = 1.26,
        source = "User defined — field testing",
        note = "Rotary adjusts P value"),
)

private fun logInterp(x: Double, x0: Double, y0: Double, x1: Double, y1: Double): Double {
    if (x <= 0 || x0 <= 0 || x1 <= 0) return y0
    val logRatio = ln(x / x0) / ln(x1 / x0)
    return y0 * (y1 / y0).pow(logRatio)
}

private fun lookupReciprocity(metered: Double, dataPoints: List<Pair<Double, Double>>): Double {
    if (metered < dataPoints.first().first) return metered
    if (metered >= dataPoints.last().first) {
        val (x0, y0) = dataPoints[dataPoints.size - 2]
        val (x1, y1) = dataPoints.last()
        return logInterp(metered, x0, y0, x1, y1)
    }
    for (i in 0 until dataPoints.size - 1) {
        val (x0, y0) = dataPoints[i]
        val (x1, y1) = dataPoints[i + 1]
        if (metered in x0..x1) return logInterp(metered, x0, y0, x1, y1)
    }
    return metered
}

/**
 * Adjusted exposure in seconds. Returns metered unchanged for sub-1s.
 * Matches calculate() in ReciprocityScreen.tsx.
 */
fun calculateAdjusted(stock: FilmStock, metered: Double): Double {
    if (metered < 1.0) return metered
    return when (stock.method) {
        Method.POWER -> maxOf(metered, metered.pow(stock.p ?: 1.0))
        Method.LOOKUP -> lookupReciprocity(metered, stock.data ?: emptyList())
        Method.PORTRA -> {
            val stops = 0.5167 * ln(metered) - 0.2
            if (stops > 0) metered * 2.0.pow(stops) else metered
        }
        Method.PROVIA -> when {
            metered <= 128 -> metered
            metered <= 240 -> metered * 2.0.pow(0.33)
            else -> metered * 2.0.pow(0.5)
        }
    }
}

/** Returns e.g. "+1.3" or "+0" */
fun stopsCorrection(metered: Double, adjusted: Double): String {
    if (adjusted <= metered) return "+0"
    val stops = log2(adjusted / metered)
    return "+%.1f".format(stops)
}

/** Format seconds for compact display (4s · 1m 30s · 2h 15m). */
fun formatTime(seconds: Double): String {
    if (seconds < 1.0) return "%.1fs".format(seconds)
    if (seconds < 60.0) return "${round(seconds).toInt()}s"
    val totalSec = round(seconds).toInt()
    val m = totalSec / 60
    val s = totalSec % 60
    if (m < 60) return if (s > 0) "${m}m ${s}s" else "${m}m"
    val h = m / 60
    val rm = m % 60
    return if (rm > 0) "${h}h ${rm}m" else "${h}h"
}

/** Standard third-stop f-numbers for aperture priority snap. */
val STANDARD_F_STOPS = listOf(
    1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8, 3.2, 3.5,
    4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0, 9.0, 10.0, 11.0, 13.0, 14.0,
    16.0, 18.0, 20.0, 22.0, 25.0, 29.0, 32.0, 36.0, 40.0, 45.0, 51.0, 57.0, 64.0,
)

data class ApertureResult(
    val stopsDiff: Double,
    val direction: String,  // "Open" or "Close"
    val nearestF: Double,
    val targetSeconds: Double,
)

/** Mirror of apertureAdj useMemo in the RN screen. Base f/22. */
fun computeApertureAdjustment(adjusted: Double, target: Double): ApertureResult? {
    if (target <= 0) return null
    if (kotlin.math.abs(adjusted - target) < 0.5) return null
    val stopsDiff = log2(adjusted / target)
    val baseF = 22.0
    val newF = baseF / 2.0.pow(stopsDiff / 2.0)
    val nearestF = STANDARD_F_STOPS.minBy { kotlin.math.abs(it - newF) }
    return ApertureResult(
        stopsDiff = kotlin.math.abs(stopsDiff),
        direction = if (stopsDiff > 0) "Open" else "Close",
        nearestF = nearestF,
        targetSeconds = target,
    )
}
