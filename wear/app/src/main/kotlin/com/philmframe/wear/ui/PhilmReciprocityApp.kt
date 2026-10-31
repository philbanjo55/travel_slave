package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.rememberSwipeToDismissBoxState
import androidx.wear.compose.material.HorizontalPageIndicator
import androidx.wear.compose.material.PageIndicatorState
import androidx.wear.compose.material.SwipeToDismissBox
import com.philmframe.wear.data.TimerTrigger
import com.philmframe.wear.data.rememberAppState

/**
 * Top-level container. Horizontal pager across 4 main pages:
 *
 *   0 = Reciprocity   — primary calculator with rotary + START button
 *   1 = Filter stack  — toggleable filter list with running stops total
 *   2 = Aperture      — target seconds → new f-stop (snapped to thirds)
 *   3 = Reference     — adjusted exposure preview at standard times
 *
 * Overlays (shown on top of all pages, dismissed via swipe-from-left-edge):
 *   - Film picker       — invoked from the stock pill on the Reciprocity screen
 *   - Countdown timer   — invoked by the START button OR hardware Quick Button
 *
 * The Quick Button (KEYCODE_STEM_1) is captured by MainActivity, which calls
 * TimerTrigger.fire(). This Composable observes that flow and launches the
 * countdown using the current AppState.adjusted value (whatever the rotary
 * input has set as the metered exposure, with all reciprocity correction
 * applied for the currently selected film stock).
 */
@Composable
fun PhilmReciprocityApp() {
    val state = rememberAppState()
    var showFilmPicker by remember { mutableStateOf(false) }
    var countdownExposure by remember { mutableStateOf<Double?>(null) }

    // Listen for hardware Quick Button trigger
    val pendingTrigger by TimerTrigger.pending.collectAsState()
    LaunchedEffect(pendingTrigger) {
        if (pendingTrigger) {
            // Consume immediately so the button can fire again on next press
            TimerTrigger.consume()
            // Start countdown only if we're in a state where it's appropriate
            if (countdownExposure == null && !showFilmPicker) {
                countdownExposure = state.adjusted
            }
        }
    }

    val pagerState = rememberPagerState(initialPage = 0) { 2 }

    val pageIndicatorState = remember {
        object : PageIndicatorState {
            override val pageOffset: Float get() = pagerState.currentPageOffsetFraction
            override val selectedPage: Int get() = pagerState.currentPage
            override val pageCount: Int get() = 2
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(PhilmColors.background)) {
        when {
            countdownExposure != null -> {
                val dismissState = rememberSwipeToDismissBoxState()
                SwipeToDismissBox(
                    state = dismissState,
                    onDismissed = { countdownExposure = null },
                ) { isBackground ->
                    if (isBackground) {
                        Box(Modifier.fillMaxSize().background(PhilmColors.background))
                    } else {
                        CountdownScreen(
                            exposureSeconds = countdownExposure!!,
                            stockName = state.stock.name,
                            onDismiss = { countdownExposure = null },
                        )
                    }
                }
            }
            showFilmPicker -> {
                val dismissState = rememberSwipeToDismissBoxState()
                SwipeToDismissBox(
                    state = dismissState,
                    onDismissed = { showFilmPicker = false },
                ) { isBackground ->
                    if (isBackground) {
                        Box(Modifier.fillMaxSize().background(PhilmColors.background))
                    } else {
                        FilmPickerScreen(
                            state = state,
                            onDismiss = { showFilmPicker = false },
                        )
                    }
                }
            }
            else -> {
                HorizontalPager(state = pagerState) { page ->
                    when (page) {
                        0 -> ReciprocityScreen(
                            state = state,
                            onPickFilm = { showFilmPicker = true },
                            onStartTimer = { countdownExposure = state.adjusted },
                        )
                        1 -> AperturePriorityScreen(
                            state = state,
                            onStartTimer = { countdownExposure = state.apertureAdjustedSeconds },
                        )
                        // Disabled for now — un-comment + bump pageCount above to 4
                        // to restore Filter Stack and Reference Table:
                        // 2 -> FilterStackScreen(state = state)
                        // 3 -> ReferenceTableScreen(state = state)
                    }
                }
                HorizontalPageIndicator(
                    pageIndicatorState = pageIndicatorState,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 4.dp),
                )
            }
        }
    }
}
