package com.philmframe.wear.input

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper

/**
 * Walks the ContextWrapper chain to find the host Activity.
 * The raw cast `ctx as? Activity` is unreliable because Compose may
 * wrap the Activity in any number of ContextWrappers.
 */
fun Context.findActivity(): Activity? {
    var ctx: Context = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}
