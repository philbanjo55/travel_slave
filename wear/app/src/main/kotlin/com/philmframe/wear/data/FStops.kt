package com.philmframe.wear.data

/**
 * Standard third-stop f-stop sequence from f/5.6 to f/64.
 *
 * Each adjacent pair differs by exactly 1/3 stop, so the exposure time
 * multiplier between adjacent entries is 2^(1/3) ≈ 1.26. Three entries
 * apart is exactly 1 full stop (factor of 2 in exposure time).
 *
 * The values are the conventional published numbers (Sekonic, lens
 * engravings) — they're rounded but match what every photographer expects.
 */
val F_STOPS: List<Double> = listOf(
    5.6,  // 0
    6.3,  // 1
    7.1,  // 2
    8.0,  // 3
    9.0,  // 4
    10.0, // 5
    11.0, // 6
    13.0, // 7
    14.0, // 8
    16.0, // 9
    18.0, // 10
    20.0, // 11
    22.0, // 12  ← default baseline
    25.0, // 13
    29.0, // 14
    32.0, // 15
    36.0, // 16
    40.0, // 17
    45.0, // 18
    51.0, // 19
    57.0, // 20
    64.0, // 21
)

/** Index of f/22 in F_STOPS — the reciprocity baseline. */
const val F_STOPS_INDEX_F22: Int = 12

/** Pretty-print an f-stop (whole numbers as ints, fractional as one decimal). */
fun formatFStop(f: Double): String =
    if (f == f.toInt().toDouble()) "${f.toInt()}" else "%.1f".format(f)
