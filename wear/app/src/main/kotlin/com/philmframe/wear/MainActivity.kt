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
 * Hardware keys captured here (only fires while this activity is in foreground):
 *   - KEYCODE_STEM_1: Galaxy Watch Ultra's customizable Quick Button when assigned
 *     to this app (Galaxy Wearable → Watch settings → Customize keys → Quick Button)
 *   - KEYCODE_STEM_PRIMARY: legacy alias on some Wear OS firmware
 *
 * Note: when the watch is on the watch-face, the Quick Button does whatever the
 * user set system-wide. Foreground intercept only kicks in once our app is open.
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
        if (keyCode == KeyEvent.KEYCODE_STEM_1 || keyCode == KeyEvent.KEYCODE_STEM_PRIMARY) {
            TimerTrigger.fire()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
