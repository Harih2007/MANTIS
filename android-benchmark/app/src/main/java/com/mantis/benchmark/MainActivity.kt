package com.mantis.benchmark

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.content.Intent
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val cameraRequest = 42
    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            addJavascriptInterface(VoiceBridge(), "MantisVoice")
            addJavascriptInterface(TtsBridge(), "MantisTTS")
            webViewClient = LocalAssetClient()
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        val allowed = request.resources.filter {
                            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                        }.toTypedArray()
                        if (allowed.isNotEmpty()) request.grant(allowed)
                    }
                }
            }
        }
        setContentView(webView)
        textToSpeech = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) textToSpeech?.language = Locale.US
        }
        val permissions = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (permissions.any { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }) {
            ActivityCompat.requestPermissions(this, permissions, cameraRequest)
        }
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    override fun onDestroy() {
        speechRecognizer?.destroy()
        textToSpeech?.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    private inner class LocalAssetClient : WebViewClient() {
        private val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this@MainActivity))
            .build()

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            return loader.shouldInterceptRequest(request.url)
        }
    }

    inner class VoiceBridge {
        @JavascriptInterface fun start() {
            runOnUiThread {
                if (!SpeechRecognizer.isRecognitionAvailable(this@MainActivity)) {
                    webView.evaluateJavascript("window.__mantisVoiceResult('', true)", null)
                    return@runOnUiThread
                }
                speechRecognizer?.destroy()
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this@MainActivity).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onResults(results: Bundle?) {
                            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
                            webView.evaluateJavascript("window.__mantisVoiceResult(${org.json.JSONObject.quote(text)}, true)", null)
                        }
                        override fun onError(error: Int) { webView.evaluateJavascript("window.__mantisVoiceResult('', true)", null) }
                        override fun onPartialResults(partialResults: Bundle?) {
                            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
                            if (text.isNotEmpty()) webView.evaluateJavascript("window.__mantisVoiceResult(${org.json.JSONObject.quote(text)}, false)", null)
                        }
                        override fun onReadyForSpeech(params: Bundle?) = Unit
                        override fun onBeginningOfSpeech() = Unit
                        override fun onRmsChanged(rmsdB: Float) = Unit
                        override fun onBufferReceived(buffer: ByteArray?) = Unit
                        override fun onEndOfSpeech() = Unit
                        override fun onEvent(eventType: Int, params: Bundle?) = Unit
                    })
                }
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                }
                speechRecognizer?.startListening(intent)
            }
        }
        @JavascriptInterface fun stop() { runOnUiThread { speechRecognizer?.cancel() } }
    }

    inner class TtsBridge {
        @JavascriptInterface fun speak(text: String) {
            runOnUiThread {
                textToSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "mantis-guidance")
            }
        }
    }
}
