package com.pradyumna.aiengine

import android.app.Application
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

class AiEngineApplication : Application() {
    lateinit var runtime: GeckoRuntime
        private set

    lateinit var bridge: AndroidGeckoBridge
        private set

    override fun onCreate() {
        super.onCreate()
        val settings = GeckoRuntimeSettings.Builder()
            .javaScriptEnabled(true)
            .webFontsEnabled(true)
            .extensionsProcessEnabled(true)
            .build()
        runtime = GeckoRuntime.create(this, settings)
        bridge = AndroidGeckoBridge(this, runtime)
    }
}
