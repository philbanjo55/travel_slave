package com.philmframe.wear

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.philmframe.wear.data.TimerTrigger
import com.philmframe.wear.ui.PhilmReciprocityApp
import com.philmframe.wear.ui.PhilmTheme

/**
 * Single activity host. Wear OS standalone — no companion phone app needed.
 *
 * Hardware keys captured here (only fires when this activity is in foreground):
 *   - KEYCODE_STEM_1 = Galaxy Watch Ultra's customizable Quick Button
 *   - KEYCODE_STEM_PRIMARY (older naming, also handled)
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PhilmTheme {
                PhilmReciprocityApp()
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Galaxy Watch Ultra's Quick Button → request a countdown start
        // Note: Galaxy Watch hardware buttons sometimes map to STEM_1, sometimes the
        // generic STEM_PRIMARY. Handle both.
        val isQuickButton = keyCode == KeyEvent.KEYCODE_STEM_1
            || keyCode == KeyEvent.KEYCODE_STEM_PRIMARY
            || keyCode == KeyEvent.KEYCODE_STEM_2
            || keyCode == KeyEvent.KEYCODE_STEM_3
        if (isQuickButton) {
            TimerTrigger.request(seconds = 0.0) // 0 = "use current adjusted"
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
