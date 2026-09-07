package com.mantis.benchmark

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View

class DetectionOverlay(context: Context) : View(context) {
    data class Box(val label: String, val score: Float, val left: Float, val top: Float, val right: Float, val bottom: Float)
    private var boxes = emptyList<Box>()
    private var sourceWidth = 1
    private var sourceHeight = 1
    private val stroke = Paint().apply { color = Color.YELLOW; style = Paint.Style.STROKE; strokeWidth = 5f }
    private val text = Paint().apply { color = Color.YELLOW; textSize = 34f; style = Paint.Style.FILL }
    fun update(next: List<Box>, width: Int, height: Int) {
        boxes = next
        sourceWidth = width.coerceAtLeast(1)
        sourceHeight = height.coerceAtLeast(1)
        invalidate()
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        // PreviewView uses FILL_CENTER: preserve aspect ratio and apply the
        // same center crop to detector coordinates before drawing.
        val scale = maxOf(width.toFloat() / sourceWidth, height.toFloat() / sourceHeight)
        val drawnWidth = sourceWidth * scale
        val drawnHeight = sourceHeight * scale
        val offsetX = (width - drawnWidth) / 2f
        val offsetY = (height - drawnHeight) / 2f
        boxes.forEach { b ->
            val left = b.left * scale + offsetX
            val top = b.top * scale + offsetY
            val right = b.right * scale + offsetX
            val bottom = b.bottom * scale + offsetY
            canvas.drawRect(left, top, right, bottom, stroke)
            canvas.drawText("${b.label} ${(b.score * 100).toInt()}%", left, (top - 8).coerceAtLeast(35f), text)
        }
    }
}
