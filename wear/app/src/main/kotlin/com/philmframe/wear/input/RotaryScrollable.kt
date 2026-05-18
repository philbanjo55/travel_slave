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
import androidx.compose.ui.focus.focusGroup
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.rotary.onRotaryScrollEvent

/**
 * Wraps content with rotary scroll handling for the Galaxy Watch Ultra's
 * edge-touch bezel emulation. The event arrives via verticalScrollPixels.
 *
 * Key design points:
 *   - focusGroup(): scopes focus so child taps (buttons, etc.) don't steal
 *     rotary focus permanently. Without this, the first tap on a +/− button
 *     transfers focus to the button and rotary stops working.
 *   - focusKey: callers pass any value that, when changed, forces a focus
 *     re-request. Use AppState fields like selectedStockIndex, or pager page,
 *     or a manually bumped counter, to recover focus after edge cases.
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
                // verticalScrollPixels is signed; sign is what matters for our
                // integer-step UI. Caller (e.g. ReciprocityScreen) converts to ±1.
                onRotate(event.verticalScrollPixels / 60f)
                true
            }
            .focusRequester(focusRequester)
            .focusable()
            .focusGroup(),
    ) {
        content()
    }

    LaunchedEffect(focusKey) {
        try {
            focusRequester.requestFocus()
        } catch (_: Exception) {
            // Element not yet laid out on first composition pass; the next
            // recomposition with a stable focusKey will succeed.
        }
    }
}
