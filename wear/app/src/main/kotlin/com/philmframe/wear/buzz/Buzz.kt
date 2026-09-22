package com.philmframe.wear.buzz

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Haptic patterns ported 1:1 from ReciprocityScreen.tsx.
 *
 * Reference patterns (Vibration.vibrate from RN):
 *   tick → 100ms
 *   go   → [0, 300, 100, 300]    (double buzz on START)
 *   done → [0, 500, 200, 500, 200, 500]  (triple buzz on COMPLETE)
 */
object Buzz {
    fun tick(ctx: Context) = vibrate(ctx, longArrayOf(0, 100))
    fun go(ctx: Context)   = vibrate(ctx, longArrayOf(0, 300, 100, 300))
    fun done(ctx: Context) = vibrate(ctx, longArrayOf(0, 500, 200, 500, 200, 500))
    fun click(ctx: Context) = vibrate(ctx, longArrayOf(0, 30))

    private fun vibrator(ctx: Context): Vibrator {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }

    private fun vibrate(ctx: Context, pattern: LongArray) {
        val vib = vibrator(ctx)
        if (!vib.hasVibrator()) return
        vib.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }
}
