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
 * edge-touch bezel emulation. The event arrives via verticalScrollPixels.
 *
 * Focus management: rotary input requires the receiving Compose element to
 * hold focus. Child clickables (buttons, etc.) steal focus when tapped, which
 * would permanently break rotary after the first tap. We work around this by
 * re-requesting focus whenever focusKey changes. Callers should pass a reactive
 * value like state.meteredSeconds — every time the user changes the value
 * (via tap, drag, or rotary itself), focusKey changes, the LaunchedEffect
 * re-fires, and focus returns to the rotary Box. Net effect: rotary keeps
 * working between interactions.
 *
 * @param focusKey Re-requests focus whenever this value changes. Defaults to
 *                 Unit (request once on initial composition).
 * @param onRotate Called with raw delta in "lines" (sign indicates direction).
 *                 Positive = clockwise = increase value.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun RotaryScrollable(
    modifier: Modifier = Modifier,
    focusKey: Any = Unit,
    onRotate: (Float) -> Unit,
    content: @Composable () -> Unit,
) {
    val focusRequester = remember { FocusRequester() }

    Box(
        modifier = modifier
            .fillMaxSize()
            .onRotaryScrollEvent { event ->
                onRotate(event.verticalScrollPixels / 60f)
                true
            }
            .focusRequester(focusRequester)
            .focusable(),
    ) {
        content()
    }

    LaunchedEffect(focusKey) {
        try {
            focusRequester.requestFocus()
        } catch (_: Exception) {
            // Element not yet laid out on first composition pass; next change
            // in focusKey will succeed once the Box is in the tree.
        }
    }
}
