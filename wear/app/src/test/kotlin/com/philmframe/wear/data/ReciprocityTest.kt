package com.philmframe.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * Tests verifying that the Kotlin reciprocity engine produces the same outputs
 * as the TypeScript `ReciprocityScreen.tsx` implementation. Numbers below were
 * captured by running the RN app on known inputs.
 */
class ReciprocityTest {

    private fun assertClose(expected: Double, actual: Double, eps: Double = 0.01) {
        assertTrue(
            "expected $expected, got $actual (diff ${abs(expected - actual)})",
            abs(expected - actual) < eps,
        )
    }

    // ─────────────────────────────────────────────────────────────
    // Power-law films
    //   - Delta 100:   P=1.20 (Phil's Praus+Imacon calibration)
    //   - FP4+:        P=1.26 (Ilford official)
    //   - Pan F+ 50:   P=1.26 (HARMAN 4x5 launch)
    //   - HP5+:        P=1.31 (Ilford)
    //   - T-Max 100:   P=1.15 (Kodak F-4016)
    //   - SFX 200:     P=1.43 (Ilford)
    // ─────────────────────────────────────────────────────────────

    @Test fun `Delta 100 power law at 1s returns unchanged`() {
        val delta100 = FILM_STOCKS_4X5.first { it.name == "Delta 100" }
        assertClose(1.0, calculateAdjusted(delta100, 1.0))
    }

    @Test fun `Delta 100 power law at 8s gives ~12_1s`() {
        // 8^1.20 = 12.126
        val delta100 = FILM_STOCKS_4X5.first { it.name == "Delta 100" }
        assertClose(12.13, calculateAdjusted(delta100, 8.0), eps = 0.05)
    }

    @Test fun `Delta 100 power law at 60s gives ~136s`() {
        // 60^1.20 = 136.05
        val delta100 = FILM_STOCKS_4X5.first { it.name == "Delta 100" }
        assertClose(136.05, calculateAdjusted(delta100, 60.0), eps = 0.5)
    }

    @Test fun `FP4+ and Pan F+ 50 share P=1_26`() {
        val fp4 = FILM_STOCKS_4X5.first { it.name == "FP4+" }
        val panf = FILM_STOCKS_4X5.first { it.name == "Pan F+ 50" }
        assertClose(
            calculateAdjusted(fp4, 30.0),
            calculateAdjusted(panf, 30.0),
        )
    }

    @Test fun `Delta 100 corrects less than FP4+ at the same time`() {
        // Phil's P=1.20 should give a shorter adjusted time than the
        // standard P=1.26 used by FP4+ and Pan F+
        val delta100 = FILM_STOCKS_4X5.first { it.name == "Delta 100" }
        val fp4 = FILM_STOCKS_4X5.first { it.name == "FP4+" }
        val tDelta = calculateAdjusted(delta100, 30.0)
        val tFp4 = calculateAdjusted(fp4, 30.0)
        assert(tDelta < tFp4) { "Delta 100 (P=1.20) should be < FP4+ (P=1.26): $tDelta vs $tFp4" }
    }

    @Test fun `HP5+ uses P=1_31 for slightly more correction`() {
        val hp5 = FILM_STOCKS_4X5.first { it.name == "HP5+" }
        // 30^1.31 = ~83
        assertClose(82.91, calculateAdjusted(hp5, 30.0), eps = 0.5)
    }

    // ─────────────────────────────────────────────────────────────
    // Lookup-table films (Kodak Tri-X, T-Max series)
    // ─────────────────────────────────────────────────────────────

    @Test fun `T-Max 400 lookup at 1s returns ~1s`() {
        val tmy = FILM_STOCKS_4X5.first { it.name == "T-Max 400" }
        assertClose(1.0, calculateAdjusted(tmy, 1.0), eps = 0.1)
    }

    @Test fun `T-Max 400 lookup at 10s returns ~15s`() {
        val tmy = FILM_STOCKS_4X5.first { it.name == "T-Max 400" }
        assertClose(15.0, calculateAdjusted(tmy, 10.0), eps = 0.1)
    }

    @Test fun `T-Max 400 lookup at 100s returns ~200s`() {
        val tmy = FILM_STOCKS_4X5.first { it.name == "T-Max 400" }
        assertClose(200.0, calculateAdjusted(tmy, 100.0), eps = 0.5)
    }

    @Test fun `Tri-X 320 lookup at 10s returns ~50s`() {
        val trix = FILM_STOCKS_4X5.first { it.name == "Tri-X 320" }
        assertClose(50.0, calculateAdjusted(trix, 10.0), eps = 0.5)
    }

    // ─────────────────────────────────────────────────────────────
    // Provia: no correction up to 128s
    // ─────────────────────────────────────────────────────────────

    @Test fun `Provia at 60s gets no correction`() {
        val provia = FILM_STOCKS_4X5.first { it.name == "Provia 100F" }
        assertClose(60.0, calculateAdjusted(provia, 60.0))
    }

    @Test fun `Provia at 200s gets ~_33 stop correction`() {
        val provia = FILM_STOCKS_4X5.first { it.name == "Provia 100F" }
        // 200 * 2^0.33 ≈ 251
        assertClose(251.43, calculateAdjusted(provia, 200.0), eps = 1.0)
    }

    // ─────────────────────────────────────────────────────────────
    // Sub-1s exposures get no correction
    // ─────────────────────────────────────────────────────────────

    @Test fun `Sub-1s exposure returns unchanged regardless of stock`() {
        FILM_STOCKS_4X5.forEach { stock ->
            assertEquals(0.5, calculateAdjusted(stock, 0.5), 0.001)
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Aperture priority math
    // ─────────────────────────────────────────────────────────────

    @Test fun `Aperture adjust returns null when target matches`() {
        // Within 0.5s of target → no adjustment
        assertEquals(null, computeApertureAdjustment(adjusted = 60.0, target = 60.0))
    }

    @Test fun `Aperture adjust from 60s to 30s closes ~1 stop`() {
        val result = computeApertureAdjustment(adjusted = 60.0, target = 30.0)
        assertTrue(result != null)
        assertEquals("Close", result!!.direction)
        assertClose(1.0, result.stopsDiff, eps = 0.01)
    }

    @Test fun `Aperture adjust from 60s to 15s opens 2 stops to f_11`() {
        // adjusted=60, target=15 means we want LESS time → need MORE light → open up
        // stopsDiff = log2(60/15) = log2(4) = 2 (positive → Open)
        // newF = 22 / 2^(2/2) = 22 / 2 = 11 → f/11
        val result = computeApertureAdjustment(adjusted = 60.0, target = 15.0)
        assertTrue(result != null)
        assertEquals("Open", result!!.direction)
        assertClose(11.0, result.nearestF, eps = 0.5)
    }

    // ─────────────────────────────────────────────────────────────
    // Format time helper
    // ─────────────────────────────────────────────────────────────

    @Test fun `formatTime under 1s shows decimal`() {
        assertEquals("0.5s", formatTime(0.5))
    }

    @Test fun `formatTime under 60s shows seconds`() {
        assertEquals("30s", formatTime(30.0))
    }

    @Test fun `formatTime over 60s shows minutes`() {
        assertEquals("1m 30s", formatTime(90.0))
    }

    @Test fun `formatTime over 60min shows hours`() {
        assertEquals("1h 5m", formatTime(3900.0))
    }

    @Test fun `formatTime exactly 1h`() {
        assertEquals("1h", formatTime(3600.0))
    }

    // ─────────────────────────────────────────────────────────────
    // Stops correction string
    // ─────────────────────────────────────────────────────────────

    @Test fun `stopsCorrection returns +0 when no change`() {
        assertEquals("+0", stopsCorrection(metered = 10.0, adjusted = 10.0))
    }

    @Test fun `stopsCorrection at 1 stop returns +1_0`() {
        assertEquals("+1.0", stopsCorrection(metered = 10.0, adjusted = 20.0))
    }

    @Test fun `stopsCorrection at 2 stops returns +2_0`() {
        assertEquals("+2.0", stopsCorrection(metered = 10.0, adjusted = 40.0))
    }
}
