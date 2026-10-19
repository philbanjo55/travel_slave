package com.philmframe.wear.ui

import android.view.WindowManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
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
 * Conventional-timer-app aesthetic countdown screen.
 *
 * Visual language:
 *   - Pure black background (OLED + max daylight contrast)
 *   - Photo-amber progress ring hugging the round bezel (8dp stroke, rounded caps)
 *   - Ring starts full at 12 o'clock and depletes clockwise as the exposure runs
 *   - Center: large white time numerals (or amber digits in PREP / amber duration in DONE)
 *
 * Three phases:
 *   1) COUNTDOWN — 3-2-1 prep with tick haptics; ring stays full amber
 *   2) RUNNING — ring depletes; remaining time in white at center
 *   3) DONE — ring empty; the **completed exposure duration** is the headline
 *            (per the watchOS-10 Timer critique: "Done" doesn't tell you which timer
 *            fired if multiple are running; the duration does)
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
        // 3-2-1 — tick haptic on each (matches RN Vibration.vibrate(100))
        Buzz.tick(ctx)
        for (i in 2 downTo 1) {
            delay(1000)
            countdownValue = i
            Buzz.tick(ctx)
        }
        delay(1000)

        // GO — double-buzz [0,300,100,300]
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

    // Progress 1.0 = full ring at 12 sweeping all the way around. Depletes to 0.
    val progress: Float = when (phase) {
        Phase.COUNTDOWN -> 1f
        Phase.RUNNING -> (remainingMs.toFloat() / totalMs.toFloat()).coerceIn(0f, 1f)
        Phase.DONE -> 0f
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PhilmColors.background),
        contentAlignment = Alignment.Center,
    ) {
        // Circular progress ring around the bezel
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .padding(6.dp)
        ) {
            val stroke = 8.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            val topLeft = Offset(inset, inset)

            // Ghost ring — full circle at low alpha, acts as the depleted-portion track
            drawArc(
                color = PhilmColors.accentGhost,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )

            // Active progress arc — clockwise from 12 o'clock
            if (progress > 0f) {
                drawArc(
                    color = PhilmColors.accent,
                    startAngle = -90f,
                    sweepAngle = 360f * progress,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }

        // Center content
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 28.dp),
        ) {
            when (phase) {
                Phase.COUNTDOWN -> CountdownContent(countdownValue)
                Phase.RUNNING -> RunningContent(
                    remainingMs = remainingMs,
                    totalMs = totalMs,
                    stockName = stockName,
                )
                Phase.DONE -> DoneContent(
                    totalMs = totalMs,
                    stockName = stockName,
                )
            }
        }

        // Bottom action button
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 22.dp)
        ) {
            when (phase) {
                Phase.COUNTDOWN, Phase.RUNNING -> {
                    // Subdued cancel — we don't want users to misclick during a 10-min exposure
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(PhilmRadius.full))
                            .background(PhilmColors.surface)
                            .clickable { onDismiss() }
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = "CANCEL",
                            style = PhilmType.bodyMedium.copy(
                                color = PhilmColors.textSecondary,
                                fontWeight = FontWeight.W700,
                            ),
                        )
                    }
                }
                Phase.DONE -> {
                    // Filled amber — primary action, high visibility
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(PhilmRadius.full))
                            .background(PhilmColors.accent)
                            .clickable { onDismiss() }
                            .padding(horizontal = 22.dp, vertical = 8.dp),
                    ) {
                        Text(
                            text = "DONE",
                            style = PhilmType.bodyMedium.copy(
                                color = PhilmColors.textInverse,
                                fontWeight = FontWeight.W700,
                            ),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CountdownContent(value: Int) {
    Text(
        text = "GET READY",
        style = PhilmType.labelMedium.copy(color = PhilmColors.accent),
    )
    Spacer(modifier = Modifier.height(2.dp))
    Text(
        text = "$value",
        style = PhilmType.countdown.copy(color = PhilmColors.accent),
    )
    Spacer(modifier = Modifier.height(2.dp))
    Text(
        text = "Open shutter on go",
        style = PhilmType.bodySmall,
    )
}

@Composable
private fun RunningContent(remainingMs: Long, totalMs: Long, stockName: String) {
    Text(text = stockName.uppercase(), style = PhilmType.labelMedium)
    Spacer(modifier = Modifier.height(4.dp))
    Text(
        text = formatTimerDisplay(remainingMs),
        style = PhilmType.timer,
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text(
        text = "of ${formatTime(totalMs / 1000.0)}",
        style = PhilmType.bodySmall,
    )
}

@Composable
private fun DoneContent(totalMs: Long, stockName: String) {
    // Gruber's watchOS critique applied: when multiple timers might fire,
    // the user needs to know WHICH timer just completed. The exposure
    // duration is the unique identifier, so it's the headline.
    Text(
        text = "EXPOSED",
        style = PhilmType.labelMedium.copy(color = PhilmColors.accent),
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text(
        text = formatTime(totalMs / 1000.0),
        style = PhilmType.timer.copy(color = PhilmColors.accent),
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text(text = stockName, style = PhilmType.bodyMedium)
    Spacer(modifier = Modifier.height(2.dp))
    Text(
        text = "Close shutter",
        style = PhilmType.bodySmall.copy(color = PhilmColors.textSecondary),
    )
}

private fun formatTimerDisplay(ms: Long): String {
    val totalSec = ((ms + 999) / 1000).toInt() // ceil — show "1" until truly hits zero
    if (totalSec < 60) return "$totalSec"
    val m = totalSec / 60
    val s = totalSec % 60
    return "%d:%02d".format(m, s)
}
