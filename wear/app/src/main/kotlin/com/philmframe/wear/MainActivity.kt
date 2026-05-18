package com.philmframe.wear

import android.content.pm.PackageManager
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
 * When run on a Wear OS device, the app fills the screen edge-to-edge.
 * When run on a phone (for dev testing), the same Compose UI is wrapped in
 * a 360dp circular Box so you can see exactly what it'll look like on a
 * round watch face, with proper edge clipping.
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
 * Phone-only wrapper that clips the Wear UI into a 360dp circle in the middle
 * of the phone screen, so you can preview exactly how the round watch face
 * will render — including vignette edges, TimeText curving (well, it stays
 * flat on phone but the spacing is right), and content clipped to the bezel.
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

            // The "watch": 360dp circle with a subtle bezel ring
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
                content()
            }

            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "Tap, swipe, ± buttons all work — rotary doesn't (phone has no bezel)",
                fontSize = 10.sp,
                color = Color(0xFF555555),
            )
        }
    }
}
