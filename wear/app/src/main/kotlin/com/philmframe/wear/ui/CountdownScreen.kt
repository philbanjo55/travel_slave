package com.philmframe.wear.ui

import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Text
import com.philmframe.wear.buzz.Buzz
import com.philmframe.wear.data.formatTime
import com.philmframe.wear.input.findActivity
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private enum class Phase { COUNTDOWN, RUNNING, DONE }

/**
 * Countdown overlay matching the RN Modal in ReciprocityScreen.tsx:
 *   1) 3-2-1 with tick haptic (100ms each)
 *   2) GO double-buzz (300/100/300) on transition to exposure
 *   3) Live countdown of exposure with progress
 *   4) DONE triple-buzz (500/200/500/200/500) when complete
 *
 * Keeps screen awake the whole time via FLAG_KEEP_SCREEN_ON.
 */
@Composable
fun CountdownScreen(
    exposureSeconds: Double,
    stockName: String,
    onDismiss: () -> Unit,
) {
    val ctx = LocalContext.current
    val exposureMs = (exposureSeconds * 1000).toLong()

    var phase by remember { mutableStateOf(Phase.COUNTDOWN) }
    var countdownValue by remember { mutableStateOf(3) }
    var remainingMs by remember { mutableStateOf(exposureMs) }
    val totalMs = exposureMs

    // Keep screen on for the whole flow
    val activity = remember(ctx) { ctx.findActivity() }
    DisposableEffect(activity) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    LaunchedEffect(Unit) {
        // 3-2-1 countdown — buzz on each tick (matches RN: Vibration.vibrate(100))
        Buzz.tick(ctx)
        for (i in 2 downTo 1) {
            delay(1000)
            countdownValue = i
            Buzz.tick(ctx)
        }
        delay(1000)

        // GO — double-buzz [0, 300, 100, 300]
        Buzz.go(ctx)
        phase = Phase.RUNNING
        val startMs = System.currentTimeMillis()

        while (isActive) {
            val elapsed = System.currentTimeMillis() - startMs
            val r = exposureMs - elapsed
            if (r <= 0) {
                remainingMs = 0
                phase = Phase.DONE
                Buzz.done(ctx)
                break
            }
            remainingMs = r
            delay(50)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PhilmColors.background),
        contentAlignment = Alignment.Center,
    ) {
        when (phase) {
            Phase.COUNTDOWN -> CountdownState(countdownValue)
            Phase.RUNNING -> RunningState(
                remainingMs = remainingMs,
                totalMs = totalMs,
                stockName = stockName,
            )
            Phase.DONE -> DoneState(
                totalMs = totalMs,
                stockName = stockName,
            )
        }

        // Cancel/Done button at bottom
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = PhilmSpacing.lg)
                .clip(RoundedCornerShape(PhilmRadius.full))
                .background(if (phase == Phase.DONE) PhilmColors.accent else PhilmColors.surface)
                .clickable { onDismiss() }
                .padding(horizontal = PhilmSpacing.lg, vertical = PhilmSpacing.xs),
        ) {
            Text(
                text = if (phase == Phase.DONE) "DONE" else "CANCEL",
                style = PhilmType.bodyMedium.copy(
                    color = if (phase == Phase.DONE) PhilmColors.textInverse else PhilmColors.textSecondary,
                    fontWeight = FontWeight.W700,
                ),
            )
        }
    }
}

@Composable
private fun CountdownState(value: Int) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = "GET READY", style = PhilmType.labelMedium)
        Spacer(modifier = Modifier.height(PhilmSpacing.md))
        Text(text = "$value", style = PhilmType.countdown)
        Spacer(modifier = Modifier.height(PhilmSpacing.md))
        Text(
            text = "Open shutter when timer starts",
            style = PhilmType.bodySmall,
        )
    }
}

@Composable
private fun RunningState(remainingMs: Long, totalMs: Long, stockName: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = "EXPOSING — $stockName",
            style = PhilmType.labelMedium,
        )
        Spacer(modifier = Modifier.height(PhilmSpacing.sm))
        Text(text = formatTimerDisplay(remainingMs), style = PhilmType.timer)
        Spacer(modifier = Modifier.height(PhilmSpacing.sm))

        // Progress bar
        val progress = ((totalMs - remainingMs).toFloat() / totalMs).coerceIn(0f, 1f)
        Box(
            modifier = Modifier
                .fillMaxWidth(0.7f)
                .height(4.dp)
                .clip(RoundedCornerShape(PhilmRadius.sm))
                .background(PhilmColors.surface),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(progress)
                    .height(4.dp)
                    .background(PhilmColors.accent),
            )
        }

        Spacer(modifier = Modifier.height(PhilmSpacing.sm))
        Text(
            text = "${formatTime((totalMs - remainingMs) / 1000.0)} of ${formatTime(totalMs / 1000.0)}",
            style = PhilmType.bodySmall,
        )
    }
}

@Composable
private fun DoneState(totalMs: Long, stockName: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = "EXPOSURE COMPLETE", style = PhilmType.labelMedium)
        Spacer(modifier = Modifier.height(PhilmSpacing.md))
        Text(
            text = "✓",
            style = PhilmType.countdown.copy(color = PhilmColors.signalOk),
        )
        Spacer(modifier = Modifier.height(PhilmSpacing.sm))
        Text(text = "Close shutter", style = PhilmType.bodyLarge)
        Text(
            text = "${formatTime(totalMs / 1000.0)} on $stockName",
            style = PhilmType.bodySmall,
        )
    }
}

private fun formatTimerDisplay(ms: Long): String {
    val totalSec = ((ms + 999) / 1000).toInt() // ceil
    if (totalSec < 60) return "$totalSec"
    val m = totalSec / 60
    val s = totalSec % 60
    return "%d:%02d".format(m, s)
}
