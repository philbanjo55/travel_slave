package com.philmframe.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Text
import com.philmframe.wear.buzz.Buzz

/**
 * Compact ± stepper used for the Custom film stock's P value.
 *
 * Interaction:
 *   - Tap −/+      → ±0.01 (fine adjustment)
 *   - Long-press   → ±0.05 (coarse jump, fires once on long-press)
 *   - Tap center   → reset to 1.26 (Ilford-Delta baseline)
 *   - Buzzes on each tap so you feel it through gloves
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun PStepper(
    value: Double,
    onDecrement: (Double) -> Unit,
    onIncrement: (Double) -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ctx = LocalContext.current

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PhilmSpacing.xs),
    ) {
        Text(text = "P", style = PhilmType.labelMedium)
        StepperBtn(
            label = "−",
            onTap = {
                onDecrement(0.01)
                Buzz.click(ctx)
            },
            onLongPress = {
                onDecrement(0.05)
                Buzz.tick(ctx)
            },
        )

        // Current value pill — tap to reset
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(PhilmRadius.full))
                .background(PhilmColors.accentSubtle)
                .border(
                    width = 1.dp,
                    color = PhilmColors.accent,
                    shape = RoundedCornerShape(PhilmRadius.full),
                )
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = {
                            onReset()
                            Buzz.click(ctx)
                        },
                    )
                }
                .width(52.dp)
                .height(26.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "%.2f".format(value),
                style = PhilmType.bodyMedium.copy(
                    color = PhilmColors.accent,
                    fontWeight = FontWeight.W700,
                ),
            )
        }

        StepperBtn(
            label = "+",
            onTap = {
                onIncrement(0.01)
                Buzz.click(ctx)
            },
            onLongPress = {
                onIncrement(0.05)
                Buzz.tick(ctx)
            },
        )
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun StepperBtn(
    label: String,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(PhilmColors.surfaceElevated)
            .border(
                width = 1.dp,
                color = PhilmColors.border,
                shape = CircleShape,
            )
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onLongPress = { onLongPress() },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = PhilmType.bodyMedium.copy(
                color = PhilmColors.textPrimary,
                fontWeight = FontWeight.W700,
            ),
        )
    }
}
