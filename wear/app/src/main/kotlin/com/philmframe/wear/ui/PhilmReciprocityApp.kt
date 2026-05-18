package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.philmframe.wear.data.TimerTrigger
import com.philmframe.wear.data.rememberAppState

/**
 * Top-level container. Horizontal pager across 4 main pages:
 *   0 — Reciprocity (primary)
 *   1 — Filter stack
 *   2 — Aperture priority
 *   3 — Reference table
 *
 * Overlays:
 *   - Film picker (when invoked from Reciprocity)
 *   - Countdown (when timer fires from button or hardware Quick Button)
 */
@Composable
fun PhilmReciprocityApp() {
    val state = rememberAppState()
    var showFilmPicker by remember { mutableStateOf(false) }
    var countdownExposure by remember { mutableStateOf<Double?>(null) }

    // Listen for hardware Quick Button trigger
    val pendingTrigger by TimerTrigger.pending.collectAsState()
    LaunchedEffect(pendingTrigger) {
        if (pendingTrigger != null && countdownExposure == null && !showFilmPicker) {
            countdownExposure = state.adjusted
            TimerTrigger.consume()
        }
    }

    val pagerState = rememberPagerState(initialPage = 0) { 4 }

    Box(modifier = Modifier.fillMaxSize().background(PhilmColors.background)) {
        when {
            countdownExposure != null -> CountdownScreen(
                exposureSeconds = countdownExposure!!,
                stockName = state.stock.name,
                onDismiss = { countdownExposure = null },
            )
            showFilmPicker -> FilmPickerScreen(
                state = state,
                onDismiss = { showFilmPicker = false },
            )
            else -> {
                HorizontalPager(state = pagerState) { page ->
                    when (page) {
                        0 -> ReciprocityScreen(
                            state = state,
                            onPickFilm = { showFilmPicker = true },
                            onStartTimer = { countdownExposure = state.adjusted },
                        )
                        1 -> FilterStackScreen(state = state)
                        2 -> AperturePriorityScreen(state = state)
                        3 -> ReferenceTableScreen(state = state)
                    }
                }
                PageDots(
                    pageCount = 4,
                    currentPage = pagerState.currentPage,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun PageDots(pageCount: Int, currentPage: Int, modifier: Modifier = Modifier) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        repeat(pageCount) { i ->
            Box(
                modifier = Modifier
                    .padding(horizontal = 2.dp)
                    .size(if (i == currentPage) 6.dp else 4.dp)
                    .clip(CircleShape)
                    .background(
                        if (i == currentPage) PhilmColors.accent else PhilmColors.textTertiary,
                    ),
            )
        }
    }
}
