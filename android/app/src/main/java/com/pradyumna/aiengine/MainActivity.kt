package com.pradyumna.aiengine

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

class MainActivity : Activity() {
    companion object {
        var activeGeckoView: org.mozilla.geckoview.GeckoView? = null
    }

    private lateinit var bridge: AndroidGeckoBridge
    private lateinit var root: FrameLayout
    private lateinit var chatLayer: LinearLayout
    private lateinit var status: TextView
    private lateinit var messages: LinearLayout
    private lateinit var prompt: EditText
    private lateinit var providerButtons: LinearLayout
    private lateinit var geckoView: org.mozilla.geckoview.GeckoView
    private lateinit var browserBar: LinearLayout
    private var selectedProvider = "auto"
    private var currentTask: String? = null
    private val uploads = mutableListOf<AndroidGeckoBridge.UploadFile>()

    private val listener = object : AndroidGeckoBridge.Listener {
        override fun onStatus(taskId: String?, provider: String?, state: String) {
            runOnUiThread { status.text = if (provider.isNullOrBlank()) state.uppercase() else "${provider.uppercase()} · ${state.uppercase()}" }
        }

        override fun onDelta(taskId: String, provider: String, text: String) {
            runOnUiThread { findMessage(taskId)?.text = "${provider.uppercase()}\n$text" }
        }

        override fun onResult(taskId: String, provider: String, text: String, links: List<AndroidGeckoBridge.Link>, files: List<AndroidGeckoBridge.ReturnedFile>, conversationUrl: String?) {
            runOnUiThread {
                findMessage(taskId)?.text = "${provider.uppercase()}\n$text"
                links.take(30).forEach(::addLink)
                files.forEach(::saveReturnedFile)
                currentTask = null
                status.text = "BRIDGE READY"
            }
        }

        override fun onError(taskId: String, provider: String?, message: String) {
            runOnUiThread {
                if (taskId.isNotBlank()) findMessage(taskId)?.text = "ERROR\n$message" else addMessage("ERROR\n$message", null)
                currentTask = null
                status.text = "ERROR"
            }
        }

        override fun onBridgeReady(ready: Boolean) {
            runOnUiThread { status.text = if (ready) "BROWSER BRIDGE READY" else "BROWSER BRIDGE OFFLINE" }
        }

        override fun onProviderReady(provider: String) {
            runOnUiThread {
                status.text = "$provider BROWSER READY"
                if (provider == browserProviderToShow) {
                    bridge.attachProviderSession(provider, geckoView)
                    browserProviderToShow = null
                }
            }
        }
    }

    private var browserProviderToShow: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(5, 8, 15)
        window.navigationBarColor = android.graphics.Color.rgb(5, 8, 15)
        bridge = (application as AiEngineApplication).bridge
        buildUi()
        bridge.setListener(listener)
        bridge.initialize()
    }

    private fun buildUi() {
        root = FrameLayout(this).apply { setBackgroundColor(android.graphics.Color.rgb(5, 8, 15)); fitsSystemWindows = true }
        setContentView(root)

        chatLayer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(android.graphics.Color.rgb(5, 8, 15)) }
        root.addView(chatLayer, FrameLayout.LayoutParams(-1, -1))

        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(8)) }
        val title = TextView(this).apply { text = "AI ENGINE"; setTextColor(android.graphics.Color.rgb(0, 229, 255)); textSize = 16f }
        status = TextView(this).apply { text = "STARTING…"; setTextColor(android.graphics.Color.rgb(111, 143, 163)); textSize = 10f; setPadding(dp(10), 0, dp(10), 0) }
        val login = Button(this).apply { text = "BROWSER"; setOnClickListener { showBrowser(if (selectedProvider == "auto") "chatgpt" else selectedProvider) } }
        header.addView(title)
        header.addView(status)
        header.addView(login, LinearLayout.LayoutParams(0, dp(48), 1f).apply { gravity = Gravity.END })
        chatLayer.addView(header)

        providerButtons = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        chatLayer.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(providerButtons) })
        listProviders()

        val scroll = ScrollView(this)
        messages = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(12), dp(12), dp(12)) }
        scroll.addView(messages)
        chatLayer.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        val attachRow = LinearLayout(this).apply { setPadding(dp(10), dp(4), dp(10), dp(2)) }
        val attach = Button(this).apply { text = "ATTACH"; setOnClickListener { chooseFiles() } }
        val newConv = Button(this).apply { text = "NEW"; setOnClickListener { isSelected = !isSelected; alpha = if (isSelected) 1f else 0.6f }; alpha = 0.6f }
        attachRow.addView(attach)
        attachRow.addView(newConv)
        chatLayer.addView(attachRow)

        val inputRow = LinearLayout(this).apply { setPadding(dp(10), dp(2), dp(10), dp(10)); gravity = Gravity.BOTTOM }
        prompt = EditText(this).apply {
            hint = "Ask the selected AI website…"
            setHintTextColor(android.graphics.Color.rgb(111, 143, 163))
            setTextColor(android.graphics.Color.rgb(216, 246, 255))
            setBackgroundColor(android.graphics.Color.rgb(10, 22, 40))
            minLines = 2
            maxLines = 5
        }
        val send = Button(this).apply { text = "SEND"; setOnClickListener { submit(newConv.isSelected) } }
        inputRow.addView(prompt, LinearLayout.LayoutParams(0, dp(72), 1f))
        inputRow.addView(send, LinearLayout.LayoutParams(dp(90), dp(72)))
        chatLayer.addView(inputRow)

        geckoView = org.mozilla.geckoview.GeckoView(this).apply {
            visibility = View.GONE
            setViewBackend(org.mozilla.geckoview.GeckoView.BACKEND_TEXTURE_VIEW)
        }
        activeGeckoView = geckoView
        root.addView(geckoView, FrameLayout.LayoutParams(-1, -1))

        browserBar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(android.graphics.Color.rgb(5, 8, 15))
            setPadding(dp(8), dp(8), dp(8), dp(8))
            visibility = View.GONE
        }
        val back = Button(this).apply { text = "←"; setOnClickListener { geckoView.getSession()?.goBack() } }
        val done = Button(this).apply { text = "DONE"; setOnClickListener { hideBrowser() } }
        browserBar.addView(back)
        browserBar.addView(TextView(this).apply { text = "  Provider browser / login"; setTextColor(android.graphics.Color.rgb(216,246,255)); textSize = 13f }, LinearLayout.LayoutParams(0, dp(48), 1f))
        browserBar.addView(done)
        root.addView(browserBar, FrameLayout.LayoutParams(-1, dp(64), Gravity.TOP))
    }

    private fun listProviders() {
        providerButtons.removeAllViews()
        val all = listOf("auto") + AndroidGeckoBridge.PROVIDER_URLS.keys
        all.forEach { provider ->
            providerButtons.addView(Button(this).apply {
                text = provider.uppercase()
                setOnClickListener {
                    selectedProvider = provider
                    listProviders()
                    if (provider != "auto") bridge.openProvider(provider)
                }
            })
        }
    }

    private fun submit(newConversation: Boolean) {
        val text = prompt.text?.toString()?.trim().orEmpty()
        if (text.isEmpty() || currentTask != null) return
        val id = "a-${System.currentTimeMillis().toString(36)}"
        currentTask = id
        addMessage("YOU\n$text", null)
        addMessage("QUEUED", id)
        prompt.setText("")
        bridge.sendTask(id, selectedProvider, text, newConversation, uploads.toList())
        uploads.clear()
    }

    private fun chooseFiles() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }, 44)
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 44 || resultCode != RESULT_OK || data == null) return
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
        data.data?.let { uris.add(it) }
        uris.distinct().take(5).forEach { uri -> readUpload(uri)?.let { uploads.add(it) } }
        if (uploads.isNotEmpty()) status.text = "${uploads.size} ATTACHMENT(S) READY"
    }

    private fun readUpload(uri: Uri): AndroidGeckoBridge.UploadFile? {
        return try {
            val resolver = contentResolver
            val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else "attachment" } ?: "attachment"
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
            if (bytes.size > 20 * 1024 * 1024) return null
            AndroidGeckoBridge.UploadFile(name, mime, android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
        } catch (_: Throwable) { null }
    }

    private fun showBrowser(provider: String) {
        browserProviderToShow = provider
        geckoView.visibility = View.VISIBLE
        browserBar.visibility = View.VISIBLE
        chatLayer.visibility = View.GONE
        bridge.showProvider(provider)
        bridge.getSession(provider)?.let { session ->
            try { geckoView.releaseSession()?.setActive(false) } catch (_: Throwable) {}
            session.setActive(true)
            geckoView.setSession(session)
        }
    }

    private fun hideBrowser() {
        browserProviderToShow = null
        geckoView.visibility = View.GONE
        browserBar.visibility = View.GONE
        try { geckoView.releaseSession()?.setActive(false) } catch (_: Throwable) {}
        chatLayer.visibility = View.VISIBLE
    }

    private fun addMessage(text: String, id: String?): TextView {
        val tv = TextView(this).apply {
            this.text = text
            setTextColor(android.graphics.Color.rgb(216, 246, 255))
            textSize = 14f
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setBackgroundColor(android.graphics.Color.rgb(10, 22, 40))
        }
        if (id != null) tv.tag = id
        messages.addView(tv, LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) })
        return tv
    }

    private fun findMessage(id: String): TextView? {
        for (i in 0 until messages.childCount) {
            val v = messages.getChildAt(i)
            if (v.tag == id && v is TextView) return v
        }
        return null
    }

    private fun addLink(link: AndroidGeckoBridge.Link) {
        val tv = TextView(this).apply {
            text = "🔗 ${link.label.ifBlank { link.url }}\n${link.url}"
            setTextColor(android.graphics.Color.rgb(0, 229, 255))
            textSize = 12f
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setOnClickListener { try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link.url))) } catch (_: Throwable) {} }
        }
        messages.addView(tv)
    }

    private fun saveReturnedFile(file: AndroidGeckoBridge.ReturnedFile) {
        try {
            val dir = File(filesDir, "outputs").apply { mkdirs() }
            var out = File(dir, safeFileName(file.name))
            var n = 1
            while (out.exists()) out = File(dir, "${out.nameWithoutExtension}-${n++}.${out.extension.ifBlank { "bin" }}")
            FileOutputStream(out).use { it.write(android.util.Base64.decode(file.dataBase64, android.util.Base64.DEFAULT)) }
            val uri = FileProvider.getUriForFile(this, "com.pradyumna.aiengine.fileprovider", out)
            val tv = TextView(this).apply {
                text = "📎 ${out.name}"
                setTextColor(android.graphics.Color.rgb(255, 180, 0))
                setPadding(dp(12), dp(8), dp(12), dp(8))
                setOnClickListener {
                    val view = Intent(Intent.ACTION_VIEW).apply { setDataAndType(uri, file.mime); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                    try { startActivity(view) } catch (_: Throwable) {
                        val share = Intent(Intent.ACTION_SEND).apply { type = file.mime; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                        startActivity(Intent.createChooser(share, "Open file with"))
                    }
                }
            }
            messages.addView(tv)
        } catch (_: Throwable) {}
    }

    private fun safeFileName(name: String): String = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(100).ifBlank { "download" }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onPause() {
        super.onPause()
        if (geckoView.visibility == View.VISIBLE) {
            try { geckoView.getSession()?.setActive(false) } catch (_: Throwable) {}
        }
    }

    override fun onResume() {
        super.onResume()
        if (geckoView.visibility == View.VISIBLE) {
            try { geckoView.getSession()?.setActive(true) } catch (_: Throwable) {}
        }
    }

    override fun onBackPressed() {
        if (geckoView.visibility == View.VISIBLE) { hideBrowser(); return }
        super.onBackPressed()
    }

    override fun onDestroy() {
        try { geckoView.releaseSession()?.setActive(false) } catch (_: Throwable) {}
        if (MainActivity.activeGeckoView === geckoView) MainActivity.activeGeckoView = null
        bridge.setListener(null)
        super.onDestroy()
    }
}
