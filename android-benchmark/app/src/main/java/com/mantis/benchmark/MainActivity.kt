package com.mantis.benchmark

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import java.util.concurrent.Executors
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private lateinit var preview: PreviewView
    private lateinit var overlay: DetectionOverlay
    private lateinit var status: TextView
    private var detector: ObjectDetector? = null
    private val executor = Executors.newSingleThreadExecutor()
    private val requestCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) startCamera() else status.text = "Camera permission denied" }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = android.widget.FrameLayout(this)
        root.setBackgroundColor(0xFF111214.toInt())
        preview = PreviewView(this)
        preview.scaleType = PreviewView.ScaleType.FILL_CENTER
        overlay = DetectionOverlay(this)
        status = TextView(this).apply { setTextColor(0xFFFFFFFF.toInt()); setBackgroundColor(0xCC111111.toInt()); setPadding(24, 16, 24, 16); textSize = 14f; text = "Starting benchmark…" }
        root.addView(preview, android.widget.FrameLayout.LayoutParams(-1, -1))
        root.addView(overlay, android.widget.FrameLayout.LayoutParams(-1, -1))
        val header = TextView(this).apply {
            text = "  MANTIS   •   FIND AN OBJECT"
            setTextColor(0xFFFFC226.toInt()); setBackgroundColor(0xDD111214.toInt())
            setPadding(20, 22, 20, 18); textSize = 18f
        }
        root.addView(header, android.widget.FrameLayout.LayoutParams(-1, -2))
        val params = android.widget.FrameLayout.LayoutParams(-1, -2); params.topMargin = 68; root.addView(status, params)
        val controls = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(20, 16, 20, 24); setBackgroundColor(0xEE17181A.toInt())
        }
        val target = TextView(this).apply { text = "Searching with camera"; setTextColor(0xFFFFD66B.toInt()); textSize = 16f; setPadding(0, 0, 0, 10) }
        controls.addView(target)
        val row = android.widget.LinearLayout(this).apply { orientation = android.widget.LinearLayout.HORIZONTAL }
        listOf("Headphones", "Backpack", "Scan room").forEach { label ->
            val button = android.widget.Button(this).apply {
                text = label; textSize = 11f; setTextColor(0xFFFFFFFF.toInt()); setOnClickListener { target.text = "Finding $label" }
            }
            row.addView(button, android.widget.LinearLayout.LayoutParams(0, -2, 1f))
        }
        controls.addView(row)
        val bottom = android.widget.FrameLayout.LayoutParams(-1, -2, android.view.Gravity.BOTTOM)
        root.addView(controls, bottom)
        setContentView(root)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera() else requestCamera.launch(Manifest.permission.CAMERA)
    }

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val options = ObjectDetector.ObjectDetectorOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("efficientdet_lite0.tflite").build())
                .setScoreThreshold(0.3f).setMaxResults(5).build()
            val initStart = SystemClock.elapsedRealtime()
            try { detector = ObjectDetector.createFromOptions(this, options) } catch (e: Exception) { status.text = "Detector init failed: ${e.message}"; return@addListener }
            status.text = "Model ready in ${SystemClock.elapsedRealtime() - initStart} ms · CPU"
            val cameraPreview = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setTargetResolution(android.util.Size(640, 480))
                .setOutputImageRotationEnabled(true)
                .build()
            analysis.setAnalyzer(executor) { image ->
                val start = SystemClock.elapsedRealtimeNanos()
                try {
                    // With output rotation enabled, the bitmap dimensions are
                    // portrait-oriented even when ImageProxy reports the
                    // sensor's landscape dimensions. Use the bitmap size for
                    // overlay mapping so boxes share the detector's coordinate space.
                    val bitmap = image.toBitmap()
                    val mpImage = BitmapImageBuilder(bitmap).build()
                    val result = detector?.detect(mpImage)
                    val latency = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000
                    val boxes = result?.detections()?.mapNotNull { d ->
                        val b = d.boundingBox(); val cat = d.categories().firstOrNull() ?: return@mapNotNull null
                        // CameraX commonly delivers a landscape analysis frame while
                        // the PreviewView is portrait. Rotate detector coordinates
                        // clockwise into the portrait space before drawing.
                        if (bitmap.width > bitmap.height) {
                            DetectionOverlay.Box(cat.categoryName(), cat.score(),
                                bitmap.height - b.bottom, b.left,
                                bitmap.height - b.top, b.right)
                        } else {
                            DetectionOverlay.Box(cat.categoryName(), cat.score(), b.left, b.top, b.right, b.bottom)
                        }
                    } ?: emptyList()
                    runOnUiThread {
                        overlay.update(boxes, bitmap.width, bitmap.height)
                        status.text = "${latency} ms · ${(1000f / latency.coerceAtLeast(1)).roundToInt()} FPS · ${boxes.joinToString { it.label }}"
                    }
                } catch (e: Exception) { runOnUiThread { status.text = "Inference error: ${e.message}" } } finally { image.close() }
            }
            provider.unbindAll(); provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, analysis)
        }, ContextCompat.getMainExecutor(this))
    }
}
