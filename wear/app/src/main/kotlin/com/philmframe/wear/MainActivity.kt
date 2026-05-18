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
 * On a phone (dev testing) the same Compose UI is wrapped in a 380dp circular
 * Box with inner padding so TimeText and page dots stay inside the visible
 * round area instead of being clipped at the corners.
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

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_STEM_1 || keyCode == KeyEvent.KEYCODE_STEM_PRIMARY) {
            TimerTrigger.fire()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}

/**
 * Phone-only wrapper: 380dp circle in the middle of the phone screen with a
 * subtle bezel ring, plus a "SIMULATE QUICK BUTTON" tap target below it so
 * Phil can test the hardware-key flow without sideloading to the watch.
 *
 * Inner padding of 18dp insets the Wear UI from the bezel so TimeText (top)
 * and page dots (bottom) don't get clipped where the circle curves inward.
 */
@Composable
private fun PhonePreviewFrame(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0A0A0A)), // very dark slate for the "table" around the watch
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "PHONE PREVIEW — Galaxy Watch Ultra shape",
                fontWeight = FontWeight.W600,
                fontSize = 11.sp,
                color = Color(0xFF666666),
            )
            Spacer(modifier = Modifier.height(12.dp))

            // The "watch": 380dp circle with bezel ring and inset content
            Box(
                modifier = Modifier
                    .size(380.dp)
                    .clip(CircleShape)
                    .border(
                        width = 6.dp,
                        color = Color(0xFF1A1A1A),
                        shape = CircleShape,
                    )
                    .background(PhilmColors.background),
            ) {
                // 18dp inner padding so TimeText/page dots stay inside the round area
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(18.dp),
                ) {
                    content()
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

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
