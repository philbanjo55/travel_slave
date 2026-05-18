package com.philmframe.wear.data

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Global trigger for "start countdown now". The MainActivity sets this from
 * its hardware-key handler (Quick Button); the navigation composable observes it.
 * Reset to null after consumption.
 */
object TimerTrigger {
    val pending = MutableStateFlow<Double?>(null)

    /** Request countdown with the given exposure seconds. */
    fun request(seconds: Double) {
        pending.value = seconds
    }

    fun consume() {
        pending.value = null
    }
}
