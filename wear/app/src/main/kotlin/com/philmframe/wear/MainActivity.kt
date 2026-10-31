package com.philmframe.wear

import android.content.pm.PackageManager
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import com.philmframe.wear.data.TimerTrigger
import com.philmframe.wear.ui.PhilmColors
import com.philmframe.wear.ui.PhilmReciprocityApp
import com.philmframe.wear.ui.PhilmTheme

/**
 * Single activity host. Wear OS standalone — no companion phone app needed.
 *
 * On a Wear OS device the app fills the screen edge-to-edge.
 * On a phone (dev testing) the same Compose UI is wrapped in a 240dp circular
 * Box — the Galaxy Watch Ultra's true 1.5" / 38.1mm display diameter.
 * Since Android dp is density-independent (160 dp = 1 inch on any device),
 * 240 dp renders at the actual physical size of the watch on Phil's phone.
 *
 * Hardware keys captured here:
 *   - KEYCODE_STEM_1: Galaxy Watch Ultra's Quick Button when mapped to this app
 *   - KEYCODE_STEM_PRIMARY: legacy alias on some Wear OS firmware
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val isWatch = packageManager.hasSystemFeature(PackageManager.FEATURE_WATCH)

        setContent {
            PhilmTheme {
                if (isWatch) {
                    PhilmReciprocityApp()
                } else {
                    PhonePreviewFrame {
                        PhilmReciprocityApp()
                    }
                }
            }
        }
    }

    /**
     * Catch hardware button presses at the highest priority point in the key
     * dispatch chain. dispatchKeyEvent runs BEFORE the view hierarchy gets the
     * event, so Compose's focused rotary handler can't consume KEYCODE_STEM_1
     * before we see it (which was the bug with the previous onKeyDown approach
     * — Compose was eating the keypress).
     *
     * We catch ALL stem keycodes because:
     *   - KEYCODE_STEM_1 is what spec says the Galaxy Watch Ultra Quick Button
     *     emits per AOSP, but Samsung's One UI Watch has been known to remap
     *     to STEM_2 in some firmware versions
     *   - KEYCODE_STEM_PRIMARY is the Home key (top right) — system-reserved
     *     for short press but in some firmware reaches apps anyway
     *   - Casting the wide net costs nothing and means the button mapping
     *     "just works" regardless of which specific code Samsung emits
     *
     * Returning true tells the system "consumed, don't propagate" — so when
     * the Quick Button is mapped via Samsung Customize Buttons to "Open this
     * app", a press while the app is already foreground fires the timer
     * instead of being a no-op re-launch.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_STEM_1,
                KeyEvent.KEYCODE_STEM_2,
                KeyEvent.KEYCODE_STEM_3,
                KeyEvent.KEYCODE_STEM_PRIMARY -> {
                    TimerTrigger.fire()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }
}

/**
 * Phone-only wrapper: 240dp circle (= Galaxy Watch Ultra's true 1.5" physical
 * display diameter) in the middle of the phone screen with a thin bezel ring,
 * plus a "SIMULATE QUICK BUTTON" tap target below it so Phil can test the
 * hardware-key flow without sideloading to the watch.
 *
 * Zero inner padding — on the real watch, Scaffold positions TimeText and
 * the page indicator along the curved bezel, so the entire 240dp circle is
 * available to content. Mirroring that here means the layout density Phil
 * sees on his phone is exactly what shows up on his wrist.
 *
 * Caveat: on phone preview, the rectangular Scaffold draws TimeText straight
 * across the top of the bounding square instead of curving it along the bezel,
 * so the corner pixels of TimeText get clipped by CircleShape. The body
 * content (which is what matters for evaluating layout density) is accurate.
 */
@Composable
private fun PhonePreviewFrame(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0A0A0A)), // dark slate for the "table" around the watch
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "PHONE PREVIEW — actual size (1.5\" / 240dp)",
                fontWeight = FontWeight.W600,
                fontSize = 11.sp,
                color = Color(0xFF666666),
            )
            Spacer(modifier = Modifier.height(12.dp))

            // The "watch": 240dp circle with thin bezel ring, zero content inset
            Box(
                modifier = Modifier
                    .size(240.dp)
                    .clip(CircleShape)
                    .border(
                        width = 2.dp,
                        color = Color(0xFF2A2A2A),
                        shape = CircleShape,
                    )
                    .background(PhilmColors.background),
            ) {
                content()
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Simulate Quick Button — fires the same TimerTrigger that
            // KEYCODE_STEM_1 fires on the actual watch
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color(0xFF2A2A2A))
                    .clickable { TimerTrigger.fire() }
                    .padding(horizontal = 20.dp, vertical = 8.dp),
            ) {
                Text(
                    text = "▶ SIMULATE QUICK BUTTON",
                    fontWeight = FontWeight.W600,
                    fontSize = 11.sp,
                    color = Color(0xFFCCCCCC),
                )
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Tap & swipe work — rotary doesn't (phone has no bezel)",
                fontSize = 9.sp,
                color = Color(0xFF555555),
            )
        }
    }
}
