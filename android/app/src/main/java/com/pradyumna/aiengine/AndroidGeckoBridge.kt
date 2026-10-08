package com.pradyumna.aiengine

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.WebExtension
import java.util.concurrent.ConcurrentHashMap

/**
 * Same-device Android browser runtime.
 *
 * The AI provider pages run inside GeckoView sessions. The built-in WebExtension
 * is the page automation layer. The native app communicates with that extension
 * using GeckoView native messaging; no provider API and no AccessibilityService
 * are used.
 */
class AndroidGeckoBridge(
    private val context: Context,
    private val runtime: GeckoRuntime,
) {
    companion object {
        private const val TAG = "AiEngineBridge"
        private const val EXT_LOCATION = "resource://android/assets/ai-chat-extension/"
        private const val EXT_ID = "ai-chat-engine@local"
        private const val NATIVE_APP = "browser"
        private const val MAX_FILE_BYTES = 20L * 1024L * 1024L

        val PROVIDER_URLS = linkedMapOf(
            "chatgpt" to "https://chatgpt.com/",
            "claude" to "https://claude.ai/new",
            "gemini" to "https://gemini.google.com/app",
            "perplexity" to "https://www.perplexity.ai/",
            "grok" to "https://grok.com/"
        )
    }

    interface Listener {
        fun onStatus(taskId: String?, provider: String?, state: String)
        fun onDelta(taskId: String, provider: String, text: String)
        fun onResult(taskId: String, provider: String, text: String, links: List<Link>, files: List<ReturnedFile>, conversationUrl: String?)
        fun onError(taskId: String, provider: String?, message: String)
        fun onBridgeReady(ready: Boolean)
        fun onProviderReady(provider: String)
    }

    data class Link(val url: String, val label: String = "")
    data class ReturnedFile(val name: String, val mime: String, val dataBase64: String)

    private val main = Handler(Looper.getMainLooper())
    private var extension: WebExtension? = null
    private var nativePort: WebExtension.Port? = null
    private var initialized = false
    private var listener: Listener? = null
    private var loginProviderToShow: String? = null

    private val sessions = ConcurrentHashMap<String, GeckoSession>()
    private val sessionProviders = ConcurrentHashMap<GeckoSession, String>()

    private val messageDelegate = object : WebExtension.MessageDelegate {
        override fun onConnect(port: WebExtension.Port) {
            main.post {
                nativePort = port
                listener?.onBridgeReady(true)
                port.setDelegate(object : WebExtension.PortDelegate {
                    override fun onPortMessage(message: Any, port: WebExtension.Port) {
                        handleExtensionMessage(message)
                    }

                    override fun onDisconnect(port: WebExtension.Port) {
                        main.post {
                            if (nativePort === port) nativePort = null
                            listener?.onBridgeReady(false)
                        }
                    }
                })
                send(JSONObject().apply {
                    put("type", "native_ready")
                    put("version", "1.0.0")
                })
            }
        }
    }

    private val tabDelegate = object : WebExtension.TabDelegate {
        override fun onNewTab(source: WebExtension, createDetails: WebExtension.CreateTabDetails): GeckoResult<GeckoSession> {
            val url = createDetails.url ?: "about:blank"
            val provider = providerForUrl(url)
            val session = GeckoSession()
            session.open(runtime)
            session.setActive(false)
            session.getWebExtensionController().setTabDelegate(source, sessionTabDelegate)
            sessionProviders[session] = provider
            sessions[provider] = session
            if (url != "about:blank") session.loadUri(url)
            main.post {
                if (loginProviderToShow == provider && provider.isNotBlank()) attachProviderSession(provider)
            }
            return GeckoResult.fromValue(session)
        }

        override fun onOpenOptionsPage(source: WebExtension) {
            // The Android app exposes its own provider/browser settings screen.
        }
    }

    private val sessionTabDelegate = object : WebExtension.SessionTabDelegate {
        override fun onUpdateTab(
            extension: WebExtension,
            session: GeckoSession,
            details: WebExtension.UpdateTabDetails
        ): GeckoResult<AllowOrDeny> {
            return GeckoResult.fromValue(AllowOrDeny.ALLOW)
        }

        override fun onCloseTab(source: WebExtension, session: GeckoSession): GeckoResult<AllowOrDeny> {
            main.post {
                val provider = sessionProviders.remove(session)
                if (provider != null) sessions.remove(provider, session)
                try { session.close() } catch (_: Throwable) {}
            }
            return GeckoResult.fromValue(AllowOrDeny.ALLOW)
        }
    }

    fun setListener(listener: Listener?) {
        this.listener = listener
        if (initialized) listener?.onBridgeReady(nativePort != null)
    }

    fun initialize() {
        if (initialized) return
        initialized = true
        runtime.getWebExtensionController()
            .ensureBuiltIn(EXT_LOCATION, EXT_ID)
            .accept({ ext ->
                main.post {
                    extension = ext
                    ext.setMessageDelegate(messageDelegate, NATIVE_APP)
                    ext.setTabDelegate(tabDelegate)
                    listener?.onBridgeReady(nativePort != null)
                }
            }, { e ->
                Log.e(TAG, "Unable to install built-in extension", e)
                main.post { listener?.onError("", null, "Browser extension install failed: ${e.message}") }
            })
    }

    fun getSession(provider: String): GeckoSession? = sessions[provider]

    fun openProvider(provider: String) {
        require(PROVIDER_URLS.containsKey(provider)) { "Unknown provider: $provider" }
        send(JSONObject().apply {
            put("type", "extension_open")
            put("provider", provider)
        })
    }

    fun showProvider(provider: String) {
        require(PROVIDER_URLS.containsKey(provider)) { "Unknown provider: $provider" }
        loginProviderToShow = provider
        openProvider(provider)
        main.postDelayed({ attachProviderSession(provider) }, 1200)
    }

    fun hideBrowser(geckoView: org.mozilla.geckoview.GeckoView) {
        main.post {
            try { geckoView.releaseSession()?.setActive(false) } catch (_: Throwable) {}
            geckoView.visibility = android.view.View.GONE
            loginProviderToShow = null
        }
    }

    fun attachProviderSession(provider: String, geckoView: org.mozilla.geckoview.GeckoView? = MainActivity.activeGeckoView) {
        val view = geckoView ?: return
        val session = sessions[provider] ?: return
        main.post {
            try { view.releaseSession()?.setActive(false) } catch (_: Throwable) {}
            session.setActive(true)
            view.visibility = android.view.View.VISIBLE
            view.setSession(session)
        }
    }

    fun sendTask(
        taskId: String,
        provider: String,
        prompt: String,
        newConversation: Boolean,
        files: List<UploadFile> = emptyList()
    ) {
        val cleanProvider = if (provider == "auto") pickProvider(prompt) else provider
        if (!PROVIDER_URLS.containsKey(cleanProvider)) {
            listener?.onError(taskId, cleanProvider, "Unknown provider")
            return
        }
        if (files.any { it.dataBase64.length > (MAX_FILE_BYTES * 4 / 3).toInt() }) {
            listener?.onError(taskId, cleanProvider, "Attachment is larger than 20 MB")
            return
        }
        send(JSONObject().apply {
            put("type", "extension_task")
            put("id", taskId)
            put("provider", cleanProvider)
            put("prompt", prompt)
            put("newConversation", newConversation)
            put("files", JSONArray().apply {
                files.forEach { file ->
                    put(JSONObject().apply {
                        put("name", file.name)
                        put("mime", file.mime)
                        put("dataBase64", file.dataBase64)
                    })
                }
            })
        })
    }

    fun cancelTask(taskId: String) {
        send(JSONObject().apply {
            put("type", "extension_cancel")
            put("id", taskId)
        })
    }

    fun clearProvider(provider: String) {
        send(JSONObject().apply {
            put("type", "extension_close")
            put("provider", provider)
        })
        sessions.remove(provider)?.let {
            sessionProviders.remove(it)
            try { it.close() } catch (_: Throwable) {}
        }
    }

    private fun send(message: JSONObject) {
        main.post {
            val port = nativePort
            if (port == null) {
                listener?.onError("", null, "Android browser bridge is not ready. Open a provider browser once and try again.")
                return@post
            }
            try { port.postMessage(message) } catch (t: Throwable) {
                Log.e(TAG, "Native bridge send failed", t)
                listener?.onBridgeReady(false)
            }
        }
    }

    private fun handleExtensionMessage(raw: Any) {
        val obj = when (raw) {
            is JSONObject -> raw
            else -> try { JSONObject(raw.toString()) } catch (_: Throwable) { return }
        }
        val type = obj.optString("type")
        val id = obj.optString("id").ifBlank { null }
        val provider = obj.optString("provider").ifBlank { null }
        main.post {
            when (type) {
                "extension_hello" -> listener?.onBridgeReady(true)
                "extension_ready" -> provider?.let {
                    listener?.onProviderReady(it)
                    if (loginProviderToShow == it) attachProviderSession(it)
                }
                "extension_status" -> listener?.onStatus(id, provider, obj.optString("state"))
                "extension_delta" -> if (id != null && provider != null) listener?.onDelta(id, provider, obj.optString("text"))
                "extension_result" -> if (id != null && provider != null) {
                    listener?.onResult(id, provider, obj.optString("text"), parseLinks(obj.optJSONArray("links")), parseFiles(obj.optJSONArray("files")), obj.optString("conversationUrl").ifBlank { null })
                }
                "extension_error" -> if (id != null) listener?.onError(id, provider, obj.optString("message", "Unknown browser error"))
            }
        }
    }

    private fun parseLinks(array: JSONArray?): List<Link> {
        if (array == null) return emptyList()
        return buildList {
            for (i in 0 until minOf(array.length(), 30)) {
                val o = array.optJSONObject(i) ?: continue
                val url = o.optString("url")
                if (url.startsWith("https://") || url.startsWith("http://")) add(Link(url, o.optString("label")))
            }
        }
    }

    private fun parseFiles(array: JSONArray?): List<ReturnedFile> {
        if (array == null) return emptyList()
        return buildList {
            for (i in 0 until minOf(array.length(), 8)) {
                val o = array.optJSONObject(i) ?: continue
                val data = o.optString("dataBase64")
                if (data.isBlank()) continue
                if (data.length.toLong() > (MAX_FILE_BYTES * 4 / 3)) continue
                add(ReturnedFile(o.optString("name", "download-${i + 1}"), o.optString("mime", "application/octet-stream"), data))
            }
        }
    }

    private fun providerForUrl(url: String): String = when {
        url.contains("chatgpt.com") || url.contains("chat.openai.com") -> "chatgpt"
        url.contains("claude.ai") -> "claude"
        url.contains("gemini.google.com") -> "gemini"
        url.contains("perplexity.ai") -> "perplexity"
        url.contains("grok.com") -> "grok"
        else -> ""
    }

    private fun pickProvider(prompt: String): String {
        val lower = prompt.lowercase()
        return when {
            Regex("\\b(research|latest|news|sources?|cite|citations?|who is|what happened|price of|compare)\\b").containsMatchIn(lower) -> "perplexity"
            Regex("\\b(tweet|twitter|x\\.com|trending|reddit|meme|viral)\\b").containsMatchIn(lower) -> "grok"
            Regex("\\b(image|photo|picture|youtube|video|google|maps|translate|gmail)\\b").containsMatchIn(lower) -> "gemini"
            Regex("\\b(code|bug|refactor|function|typescript|python|react|script|analy[sz]e|document|pdf|essay|summari[sz]e)\\b").containsMatchIn(lower) -> "claude"
            else -> "chatgpt"
        }
    }

    fun close() {
        sessions.values.forEach { try { it.close() } catch (_: Throwable) {} }
        sessions.clear()
        sessionProviders.clear()
        nativePort?.disconnect()
        nativePort = null
    }

    data class UploadFile(val name: String, val mime: String, val dataBase64: String)
}
