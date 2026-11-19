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
class EditorWebView @JvmOverloads constructor(context: Context, private val receive: (EditorMessage) -> Unit = {}, private val failed: () -> Unit = {}) : WebView(context) {
    var imageResource: ((String) -> WebResourceResponse?)? = null
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
                if (request.isForMainFrame) failed()
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                failed()
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(this, "snotesNative", setOf(EDITOR_ORIGIN)) { _, message, sourceOrigin, isMainFrame, _ ->
                // Binary payloads never enter the JSON decoder.
                if (message.type == WebMessageCompat.TYPE_STRING) {
                    EditorProtocol.decode(message.data.orEmpty(), trustedOrigin(sourceOrigin), isMainFrame)?.let(receive)
                }
            }
        }
    }
    fun start() { if (supported) loadUrl(EDITOR_URL) else failed() }
    fun send(message: String) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)) WebViewCompat.postWebMessage(this, WebMessageCompat(message), EDITOR_ORIGIN.toUri())
    }
    fun dispose() {
        stopLoading()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.removeWebMessageListener(this, "snotesNative")
        removeAllViews()
        destroy()
    }
    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    private fun trustedOrigin(uri: Uri): Boolean = uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
        uri.port in setOf(-1, 443) && uri.userInfo == null
}
