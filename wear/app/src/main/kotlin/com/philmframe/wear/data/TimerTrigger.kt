package com.philmframe.wear.data

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Hardware-key → countdown bridge.
 *
 * The MainActivity's onKeyDown handler can't directly invoke Composable state.
 * Instead it flips this StateFlow, and the navigation Composable observes it
 * via collectAsState(). When set, the Composable launches the countdown using
 * the *current* AppState.adjusted (the rotary-set value), then consumes.
 */
object TimerTrigger {
    /** True = "user pressed Quick Button, start the countdown now". */
    val pending = MutableStateFlow(false)

    fun fire() {
        pending.value = true
    }

    fun consume() {
        pending.value = false
    }
}
