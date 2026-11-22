package io.github.xilele777.snotes.core.editor

import android.content.Context
import android.net.Uri
import android.webkit.*
import android.view.ViewGroup
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.core.net.toUri
import java.io.ByteArrayInputStream

@Suppress("SetJavaScriptEnabled")
class EditorWebView @JvmOverloads constructor(
    context: Context,
    var receive: (EditorMessage) -> Unit = {},
    var failed: () -> Unit = {},
) : WebView(context) {
    var imageResource: ((String) -> WebResourceResponse?)? = null
    var isPageReady: Boolean = false
        private set
    var isLoadingPage: Boolean = false
        private set
    private var isDisposed: Boolean = false
    val supported: Boolean = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)
    private val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()

    init {
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.mediaPlaybackRequiresUserGesture = true
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                if (request.method == "GET" && trustedOrigin(request.url)) {
                    if (request.url.encodedPath?.startsWith("/api/images/") == true && request.url.query == null && request.url.fragment == null) {
                        imageResource?.invoke(request.url.path!!.removePrefix("/api/images/"))?.let { return it }
                    }
                    loader.shouldInterceptRequest(request.url)?.let { return it }
                }
                return blocked()
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    isPageReady = false
                    isLoadingPage = false
                    failed()
                }
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                isPageReady = false
                isLoadingPage = false
                EditorWebViewPool.evict(this@EditorWebView)
                failed()
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(this, "snotesNative", setOf(EDITOR_ORIGIN)) { _, message, sourceOrigin, isMainFrame, _ ->
                // Binary payloads never enter the JSON decoder.
                if (message.type == WebMessageCompat.TYPE_STRING) {
                    val decoded = EditorProtocol.decode(message.data.orEmpty(), trustedOrigin(sourceOrigin), isMainFrame)
                    if (decoded != null) {
                        if (decoded == EditorMessage.Ready) {
                            isPageReady = true
                            isLoadingPage = false
                        }
                        receive(decoded)
                    }
                }
            }
        }
    }

    fun start() {
        if (!supported) {
            failed()
            return
        }
        if (isPageReady) {
            receive(EditorMessage.Ready)
            return
        }
        if (!isLoadingPage) {
            isLoadingPage = true
            loadUrl(EDITOR_URL)
        }
    }

    fun send(message: String) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)) {
            WebViewCompat.postWebMessage(this, WebMessageCompat(message), EDITOR_ORIGIN.toUri())
        }
    }

    fun dispose() {
        if (isDisposed) return
        isDisposed = true
        isPageReady = false
        isLoadingPage = false
        receive = {}
        failed = {}
        imageResource = null
        (parent as? ViewGroup)?.removeView(this)
        stopLoading()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            runCatching { WebViewCompat.removeWebMessageListener(this, "snotesNative") }
        }
        removeAllViews()
        destroy()
    }

    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    private fun trustedOrigin(uri: Uri): Boolean = uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
        uri.port in setOf(-1, 443) && uri.userInfo == null
}

/**
 * Activity-scoped single-instance warm pool for [EditorWebView].
 * Keeps Vditor and Lute initialized across note opens so entering the editor
 * takes <15ms instead of cold-parsing 4MB of JS on every navigation.
 */
object EditorWebViewPool {
    private var cached: EditorWebView? = null

    fun prewarm(context: Context) {
        val current = cached
        if (current != null && current.context === context) return
        current?.dispose()
        cached = runCatching {
            EditorWebView(context).also { it.start() }
        }.getOrNull()
    }

    fun acquire(
        context: Context,
        receive: (EditorMessage) -> Unit,
        failed: () -> Unit,
    ): EditorWebView {
        val current = cached
        if (current != null && current.context === context) {
            cached = null
            (current.parent as? ViewGroup)?.removeView(current)
            current.receive = receive
            current.failed = failed
            return current
        }
        current?.dispose()
        cached = null
        return EditorWebView(context, receive, failed)
    }

    fun release(view: EditorWebView) {
        view.receive = {}
        view.failed = {}
        view.imageResource = null
        (view.parent as? ViewGroup)?.removeView(view)
        if (!view.isPageReady && !view.isLoadingPage) {
            view.dispose()
            return
        }
        val existing = cached
        if (existing != null && existing !== view) {
            existing.dispose()
        }
        cached = view
    }

    fun evict(view: EditorWebView) {
        if (cached === view) cached = null
        view.dispose()
    }

    fun clear(context: Context? = null) {
        val current = cached ?: return
        if (context == null || current.context === context) {
            cached = null
            current.dispose()
        }
    }
}
