package com.philmframe.wear.input

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.rotary.onRotaryScrollEvent

/**
 * Wraps content with rotary scroll handling for the Galaxy Watch Ultra's
 * digital touch bezel + crown gesture. The event arrives via verticalScrollPixels.
 *
 * @param onRotate Called with raw delta in "lines" (sign indicates direction).
 *                 Positive = clockwise = increase value.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun RotaryScrollable(
    modifier: Modifier = Modifier,
    onRotate: (Float) -> Unit,
    content: @Composable () -> Unit,
) {
    val focusRequester = remember { FocusRequester() }

    Box(
        modifier = modifier
            .fillMaxSize()
            .onRotaryScrollEvent { event ->
                // verticalScrollPixels is signed; magnitude depends on device sensitivity.
                // Normalize to a sane delta-per-tick (~1 per detent).
                onRotate(event.verticalScrollPixels / 60f)
                true
            }
            .focusRequester(focusRequester)
            .focusable(),
    ) {
        content()
    }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }
}
