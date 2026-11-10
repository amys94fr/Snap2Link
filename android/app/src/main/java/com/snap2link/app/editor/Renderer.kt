package com.snap2link.app.editor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Draws the screenshot and its marks, in image pixels. The editor draws
 * through it on screen and [export] on the image that is sent, so both
 * look the same.
 */
class Renderer(val source: Bitmap) {
    private val image = Paint(Paint.FILTER_BITMAP_FLAG)
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
    private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = text.typeface
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
    }

    /** Blurred pieces, made once per shape and way the image shows: blurring on every frame would be slow. */
    private val blurred = HashMap<Triple<Int, Boolean, Shape.Blur>, Bitmap>()

    /** The screenshot turned a quarter to the right [turns] times, then mirrored if [flipped], made once each. */
    private val turned = HashMap<Pair<Int, Boolean>, Bitmap>()

    fun image(turns: Int, flipped: Boolean): Bitmap {
        val t = turns.mod(4)
        if (t == 0 && !flipped) return source
        return turned.getOrPut(t to flipped) {
            val matrix = Matrix().apply {
                postRotate(90f * t)
                if (flipped) postScale(-1f, 1f)
            }
            Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
        }
    }

    fun width(turns: Int) = if (turns % 2 == 0) source.width else source.height

    fun height(turns: Int) = if (turns % 2 == 0) source.height else source.width

    fun draw(canvas: Canvas, shapes: List<Shape>, turns: Int, flipped: Boolean) {
        canvas.drawBitmap(image(turns, flipped), 0f, 0f, image)
        shapes.forEach { draw(canvas, it, turns, flipped) }
    }

    fun draw(canvas: Canvas, shape: Shape, turns: Int, flipped: Boolean) {
        when (shape) {
            is Shape.Pen -> {
                if (shape.points.isEmpty()) return
                stroke(shape.color, shape.width)
                val path = Path().apply {
                    moveTo(shape.points[0].x, shape.points[0].y)
                    shape.points.drop(1).forEach { lineTo(it.x, it.y) }
                }
                if (shape.points.size == 1) {
                    canvas.drawPoint(shape.points[0].x, shape.points[0].y, line)
                } else {
                    canvas.drawPath(path, line)
                }
            }
            is Shape.Rectangle -> {
                stroke(shape.color, shape.width)
                canvas.drawRect(shape.box.rect(), line)
            }
            is Shape.Circle -> {
                stroke(shape.color, shape.width)
                canvas.drawOval(shape.box.rect(), line)
            }
            is Shape.Arrow -> arrow(canvas, shape)
            is Shape.Text -> {
                text.color = shape.color
                text.textSize = shape.size
                outline.textSize = shape.size
                outline.strokeWidth = shape.size / 8
                // A dark edge keeps light text readable on a light screenshot, and the other way round.
                outline.color = if (shape.color == WHITE) 0xCC000000.toInt() else 0xCCFFFFFF.toInt()
                val baseline = shape.at.y - text.ascent()
                canvas.drawText(shape.text, shape.at.x, baseline, outline)
                canvas.drawText(shape.text, shape.at.x, baseline, text)
            }
            is Shape.Blur -> {
                val piece = blurred.getOrPut(Triple(turns, flipped, shape)) { blur(shape, image(turns, flipped)) }
                canvas.drawBitmap(piece, null, shape.box.rect(), image)
            }
        }
    }

    /** Where a text sits, measured with the font it is drawn with. */
    fun textBox(shape: Shape.Text): Box {
        text.textSize = shape.size
        val width = text.measureText(shape.text)
        val height = text.descent() - text.ascent()
        return Box(shape.at.x, shape.at.y, shape.at.x + width, shape.at.y + height)
    }

    private fun stroke(color: Int, width: Float) {
        line.color = color
        line.strokeWidth = width
    }

    private fun arrow(canvas: Canvas, shape: Shape.Arrow) {
        stroke(shape.color, shape.width)
        val angle = atan2(shape.to.y - shape.from.y, shape.to.x - shape.from.x)
        val length = shape.width * 4 + 12
        val spread = Math.toRadians(28.0).toFloat()
        // The shaft stops inside the head, so that its round end doesn't poke out of the tip.
        val back = length * cos(spread) * 0.6f
        canvas.drawLine(shape.from.x, shape.from.y, shape.to.x - back * cos(angle), shape.to.y - back * sin(angle), line)
        fill.color = shape.color
        val head = Path().apply {
            moveTo(shape.to.x, shape.to.y)
            lineTo(shape.to.x - length * cos(angle - spread), shape.to.y - length * sin(angle - spread))
            lineTo(shape.to.x - length * cos(angle + spread), shape.to.y - length * sin(angle + spread))
            close()
        }
        canvas.drawPath(head, fill)
        line.strokeJoin = Paint.Join.ROUND
        canvas.drawPath(head, line)
    }

    /**
     * The part of the screenshot under [shape], halved again and again, then
     * doubled back to its size: each step averages its neighbours, which
     * gives a soft blur with no blocks.
     */
    private fun blur(shape: Shape.Blur, source: Bitmap): Bitmap {
        val left = shape.box.left.roundToInt().coerceIn(0, source.width - 1)
        val top = shape.box.top.roundToInt().coerceIn(0, source.height - 1)
        val width = shape.box.width.roundToInt().coerceIn(1, source.width - left)
        val height = shape.box.height.roundToInt().coerceIn(1, source.height - top)
        val smallestWidth = (width / shape.cell).roundToInt().coerceAtLeast(1)
        val smallestHeight = (height / shape.cell).roundToInt().coerceAtLeast(1)
        var bitmap = Bitmap.createBitmap(source, left, top, width, height)
        val steps = ArrayList<Pair<Int, Int>>()
        while ((bitmap.width > smallestWidth || bitmap.height > smallestHeight) && (bitmap.width > 1 || bitmap.height > 1)) {
            steps += bitmap.width to bitmap.height
            bitmap = bitmap.scale((bitmap.width / 2).coerceAtLeast(1), (bitmap.height / 2).coerceAtLeast(1))
        }
        for ((w, h) in steps.asReversed()) bitmap = bitmap.scale(w, h)
        return bitmap
    }

    /** The image to send: the marks drawn on it, then the crop applied. */
    fun export(picture: Picture): Bitmap {
        val source = image(picture.turns, picture.flipped)
        val left = picture.crop.left.roundToInt().coerceIn(0, source.width - 1)
        val top = picture.crop.top.roundToInt().coerceIn(0, source.height - 1)
        val width = picture.crop.width.roundToInt().coerceIn(1, source.width - left)
        val height = picture.crop.height.roundToInt().coerceIn(1, source.height - top)
        val out = createBitmap(width, height)
        Canvas(out).apply {
            translate(-left.toFloat(), -top.toFloat())
            draw(this, picture.shapes, picture.turns, picture.flipped)
        }
        return out
    }

    private fun Box.rect() = RectF(left, top, right, bottom)

    private companion object {
        val WHITE = 0xFFFFFFFF.toInt()
    }
}
