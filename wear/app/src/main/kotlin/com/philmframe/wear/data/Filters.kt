package com.philmframe.wear.data

import kotlin.math.pow

data class Filter(
    val name: String,
    val stops: Double,
    val note: String? = null,
)

/** Mirror of FILTERS array in ReciprocityScreen.tsx. */
val FILTERS = listOf(
    Filter("Polarizer", 1.5, note = "1–2 stops, varies with angle"),
    Filter("Red 25", 3.0),
    Filter("Red 29", 4.0),
    Filter("Hoya R72", 5.0, note = "SFX 200 — most shoot at EI 6"),
    Filter("ND64", 6.0),
    Filter("3-stop ND", 3.0),
)

fun totalFilterStops(active: Set<String>): Double =
    FILTERS.filter { it.name in active }.sumOf { it.stops }

fun filterFactor(active: Set<String>): Double =
    2.0.pow(totalFilterStops(active))
