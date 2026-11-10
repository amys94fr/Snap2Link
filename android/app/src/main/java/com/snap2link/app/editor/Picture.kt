package com.snap2link.app.editor

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** A point in image pixels, not screen pixels. */
data class Pt(val x: Float, val y: Float)

/** A rectangle in image pixels, always with left <= right and top <= bottom. */
data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top

    operator fun contains(p: Pt) = p.x in left..right && p.y in top..bottom

    companion object {
        fun of(a: Pt, b: Pt) = Box(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y))
        fun of(width: Int, height: Int) = Box(0f, 0f, width.toFloat(), height.toFloat())
    }
}

enum class Tool { CROP, PEN, RECTANGLE, CIRCLE, ARROW, TEXT, BLUR }

/** The three thicknesses, as on the desktop. */
enum class Stroke { THIN, MEDIUM, THICK }

/** The desktop annotator's colours, as ARGB. */
val Palette = listOf(0xFFEF4444, 0xFFF59E0B, 0xFF22C55E, 0xFF3B82F6, 0xFFA855F7, 0xFFFFFFFF).map { it.toInt() }

sealed interface Shape {
    data class Pen(val points: List<Pt>, val color: Int, val width: Float) : Shape
    data class Rectangle(val box: Box, val color: Int, val width: Float) : Shape
    data class Circle(val box: Box, val color: Int, val width: Float) : Shape
    data class Arrow(val from: Pt, val to: Pt, val color: Int, val width: Float) : Shape

    /** [at] is the top left corner of the text. */
    data class Text(val at: Pt, val text: String, val color: Int, val size: Float) : Shape

    /** [cell]: how many image pixels melt into one, the larger the blurrier. */
    data class Blur(val box: Box, val cell: Float) : Shape
}

/**
 * Sizes follow the image, so that a mark looks the same on a phone
 * screenshot and on a large photo: one unit is 1/360 of the shorter side.
 */
class Sizes(width: Int, height: Int) {
    val unit = max(1f, min(width, height) / 360f)

    fun line(stroke: Stroke) = unit * when (stroke) {
        Stroke.THIN -> 2f
        Stroke.MEDIUM -> 4f
        Stroke.THICK -> 8f
    }

    fun text(stroke: Stroke) = unit * when (stroke) {
        Stroke.THIN -> 12f
        Stroke.MEDIUM -> 18f
        Stroke.THICK -> 28f
    }

    fun blur(stroke: Stroke) = unit * when (stroke) {
        Stroke.THIN -> 3f
        Stroke.MEDIUM -> 6f
        Stroke.THICK -> 12f
    }

    /** Below this, a drag was most likely a slip: no shape. */
    val smallest get() = unit * 4f
}

/** What is sent: the marks, and the part of the image to keep. */
data class Picture(val shapes: List<Shape>, val crop: Box) {
    companion object {
        fun blank(width: Int, height: Int) = Picture(emptyList(), Box.of(width, height))
    }
}

/** Undo and redo over whole pictures, as on the desktop (50 steps). */
data class Edits(val now: Picture, val past: List<Picture> = emptyList(), val future: List<Picture> = emptyList()) {
    val canUndo get() = past.isNotEmpty()
    val canRedo get() = future.isNotEmpty()

    fun then(next: Picture): Edits =
        if (next == now) this else Edits(next, (past + now).takeLast(LIMIT), emptyList())

    fun undo(): Edits = if (!canUndo) this else Edits(past.last(), past.dropLast(1), listOf(now) + future)

    fun redo(): Edits = if (!canRedo) this else Edits(future.first(), past + now, future.drop(1))

    private companion object {
        const val LIMIT = 50
    }
}

/** The crop frame's corners and edges, and its inside to move it. */
enum class Handle { MOVE, LEFT, TOP, RIGHT, BOTTOM, TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT }

object Crop {
    /** What a finger at [p] grabs, [reach] being how far a touch may miss. Corners first. */
    fun handleAt(crop: Box, p: Pt, reach: Float): Handle? {
        val nearLeft = abs(p.x - crop.left) <= reach
        val nearRight = abs(p.x - crop.right) <= reach
        val nearTop = abs(p.y - crop.top) <= reach
        val nearBottom = abs(p.y - crop.bottom) <= reach
        val inX = p.x in crop.left - reach..crop.right + reach
        val inY = p.y in crop.top - reach..crop.bottom + reach
        return when {
            nearTop && nearLeft -> Handle.TOP_LEFT
            nearTop && nearRight -> Handle.TOP_RIGHT
            nearBottom && nearLeft -> Handle.BOTTOM_LEFT
            nearBottom && nearRight -> Handle.BOTTOM_RIGHT
            nearLeft && inY -> Handle.LEFT
            nearRight && inY -> Handle.RIGHT
            nearTop && inX -> Handle.TOP
            nearBottom && inX -> Handle.BOTTOM
            p in crop -> Handle.MOVE
            else -> null
        }
    }

    /** [start] moved by ([dx], [dy]) through [handle], kept inside [bounds] and at least [smallest] wide and high. */
    fun drag(start: Box, handle: Handle, dx: Float, dy: Float, bounds: Box, smallest: Float): Box {
        if (handle == Handle.MOVE) {
            val x = (start.left + dx).coerceIn(bounds.left, bounds.right - start.width)
            val y = (start.top + dy).coerceIn(bounds.top, bounds.bottom - start.height)
            return Box(x, y, x + start.width, y + start.height)
        }
        val size = min(smallest, min(bounds.width, bounds.height))
        var (left, top, right, bottom) = start
        if (handle in setOf(Handle.LEFT, Handle.TOP_LEFT, Handle.BOTTOM_LEFT)) {
            left = (start.left + dx).coerceIn(bounds.left, start.right - size)
        }
        if (handle in setOf(Handle.RIGHT, Handle.TOP_RIGHT, Handle.BOTTOM_RIGHT)) {
            right = (start.right + dx).coerceIn(start.left + size, bounds.right)
        }
        if (handle in setOf(Handle.TOP, Handle.TOP_LEFT, Handle.TOP_RIGHT)) {
            top = (start.top + dy).coerceIn(bounds.top, start.bottom - size)
        }
        if (handle in setOf(Handle.BOTTOM, Handle.BOTTOM_LEFT, Handle.BOTTOM_RIGHT)) {
            bottom = (start.bottom + dy).coerceIn(start.top + size, bounds.bottom)
        }
        return Box(left, top, right, bottom)
    }
}

/** How [source] fits a view of [width] x [height], centred, with [margin] around it. */
data class Fit(val source: Box, val scale: Float, val offsetX: Float, val offsetY: Float) {
    fun toImage(x: Float, y: Float) = Pt(source.left + (x - offsetX) / scale, source.top + (y - offsetY) / scale)
    fun toViewX(x: Float) = offsetX + (x - source.left) * scale
    fun toViewY(y: Float) = offsetY + (y - source.top) * scale

    companion object {
        fun of(source: Box, width: Float, height: Float, margin: Float): Fit {
            val scale = min((width - 2 * margin) / source.width, (height - 2 * margin) / source.height).coerceAtLeast(0.01f)
            return Fit(
                source,
                scale,
                (width - source.width * scale) / 2,
                (height - source.height * scale) / 2,
            )
        }
    }
}
