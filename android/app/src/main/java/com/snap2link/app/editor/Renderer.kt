package com.snap2link.app.editor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import androidx.core.graphics.withSave
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
    private val lit = Paint(Paint.FILTER_BITMAP_FLAG)
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

    /** How the image shows: what a blur's colours depend on. */
    private data class Look(val turns: Int, val flipped: Boolean, val angle: Float, val brightness: Int, val contrast: Int)

    private fun Picture.look() = Look(turns, flipped, angle, brightness, contrast)

    /** Blurred pieces, made once per shape and way the image shows: blurring on every frame would be slow. */
    private val blurred = HashMap<Pair<Look, Shape.Blur>, Bitmap>()

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

    /** The image's size after [turns], before any tilt. */
    fun width(turns: Int) = if (turns % 2 == 0) source.width else source.height

    fun height(turns: Int) = if (turns % 2 == 0) source.height else source.width

    /** The size [picture] shows at: its tilt needs a larger frame. */
    fun shownSize(picture: Picture): Pair<Float, Float> =
        Tilt.size(width(picture.turns).toFloat(), height(picture.turns).toFloat(), picture.angle)

    /** The whole image of [picture] with no empty corner: what "Whole image" crops to. */
    fun whole(picture: Picture): Box = Tilt.inner(width(picture.turns).toFloat(), height(picture.turns).toFloat(), picture.angle)

    fun draw(canvas: Canvas, shapes: List<Shape>, picture: Picture) {
        drawImage(canvas, picture)
        shapes.forEach { draw(canvas, it, picture) }
    }

    /** The paint for the screenshot: brightness and contrast change it, never the marks. */
    private fun imagePaint(picture: Picture): Paint {
        if (!picture.adjusted) return image
        lit.colorFilter = ColorMatrixColorFilter(Light.matrix(picture.brightness, picture.contrast))
        return lit
    }

    private fun drawImage(canvas: Canvas, picture: Picture) {
        val base = image(picture.turns, picture.flipped)
        val paint = imagePaint(picture)
        if (picture.angle == 0f) {
            canvas.drawBitmap(base, 0f, 0f, paint)
            return
        }
        val (width, height) = shownSize(picture)
        canvas.withSave {
            translate(width / 2, height / 2)
            rotate(picture.angle)
            translate(-base.width / 2f, -base.height / 2f)
            drawBitmap(base, 0f, 0f, paint)
        }
    }

    /** The image as it shows, tilt and light included, in pixels: what a blur takes its colours from. Kept for one look at a time. */
    private var shownKey: Look? = null
    private var shownBitmap: Bitmap? = null

    private fun shown(picture: Picture): Bitmap {
        if (picture.angle == 0f && !picture.adjusted) return image(picture.turns, picture.flipped)
        val key = picture.look()
        shownBitmap?.takeIf { shownKey == key }?.let { return it }
        val (width, height) = shownSize(picture)
        val bitmap = createBitmap(width.roundToInt().coerceAtLeast(1), height.roundToInt().coerceAtLeast(1))
        drawImage(Canvas(bitmap), picture)
        shownKey = key
        shownBitmap = bitmap
        return bitmap
    }

    fun draw(canvas: Canvas, shape: Shape, picture: Picture) {
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
                val piece = blurred.getOrPut(picture.look() to shape) { blur(shape, shown(picture)) }
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
        val (shownWidth, shownHeight) = shownSize(picture)
        val fullWidth = shownWidth.roundToInt().coerceAtLeast(1)
        val fullHeight = shownHeight.roundToInt().coerceAtLeast(1)
        val left = picture.crop.left.roundToInt().coerceIn(0, fullWidth - 1)
        val top = picture.crop.top.roundToInt().coerceIn(0, fullHeight - 1)
        val width = picture.crop.width.roundToInt().coerceIn(1, fullWidth - left)
        val height = picture.crop.height.roundToInt().coerceIn(1, fullHeight - top)
        val out = createBitmap(width, height)
        Canvas(out).apply {
            translate(-left.toFloat(), -top.toFloat())
            draw(this, picture.shapes, picture)
        }
        return out
    }

    private fun Box.rect() = RectF(left, top, right, bottom)

    private companion object {
        val WHITE = 0xFFFFFFFF.toInt()
    }
}
