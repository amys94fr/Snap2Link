package com.snap2link.app.editor

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** A point in image pixels, not screen pixels. */
data class Pt(val x: Float, val y: Float)

/** A rectangle in image pixels, always with left <= right and top <= bottom. */
data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top

    operator fun contains(p: Pt) = p.x in left..right && p.y in top..bottom

    fun moved(dx: Float, dy: Float) = Box(left + dx, top + dy, right + dx, bottom + dy)

    fun grown(by: Float) = Box(left - by, top - by, right + by, bottom + by)

    companion object {
        fun of(a: Pt, b: Pt) = Box(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y))
        fun of(width: Int, height: Int) = Box(0f, 0f, width.toFloat(), height.toFloat())
    }
}

enum class Tool { CROP, SELECT, PEN, RECTANGLE, CIRCLE, ARROW, TEXT, BLUR }

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

/**
 * What is sent: the marks, the part of the image to keep, and how many
 * quarter turns to the right the image took. Marks and crop are in the
 * pixels of the turned image.
 */
data class Picture(val shapes: List<Shape>, val crop: Box, val turns: Int = 0) {
    /**
     * A quarter turn to the right of an image now [width] x [height]: the
     * marks and the crop turn with it. A text turns around its middle but
     * stays level, so that it can still be read.
     */
    fun turned(width: Int, height: Int, textBox: (Shape.Text) -> Box): Picture {
        val h = height.toFloat()
        fun turn(p: Pt) = Pt(h - p.y, p.x)
        fun turn(b: Box) = Box.of(turn(Pt(b.left, b.top)), turn(Pt(b.right, b.bottom)))
        val shapes = shapes.map { shape ->
            when (shape) {
                is Shape.Pen -> shape.copy(points = shape.points.map(::turn))
                is Shape.Rectangle -> shape.copy(box = turn(shape.box))
                is Shape.Circle -> shape.copy(box = turn(shape.box))
                is Shape.Arrow -> shape.copy(from = turn(shape.from), to = turn(shape.to))
                is Shape.Blur -> shape.copy(box = turn(shape.box))
                is Shape.Text -> {
                    val box = textBox(shape)
                    val middle = turn(Pt((box.left + box.right) / 2, (box.top + box.bottom) / 2))
                    shape.copy(at = Pt(middle.x - box.width / 2, middle.y - box.height / 2))
                }
            }
        }
        return Picture(shapes, turn(crop), (turns + 1) % 4)
    }

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

fun Shape.moved(dx: Float, dy: Float): Shape = when (this) {
    is Shape.Pen -> copy(points = points.map { Pt(it.x + dx, it.y + dy) })
    is Shape.Rectangle -> copy(box = box.moved(dx, dy))
    is Shape.Circle -> copy(box = box.moved(dx, dy))
    is Shape.Arrow -> copy(from = Pt(from.x + dx, from.y + dy), to = Pt(to.x + dx, to.y + dy))
    is Shape.Text -> copy(at = Pt(at.x + dx, at.y + dy))
    is Shape.Blur -> copy(box = box.moved(dx, dy))
}

/**
 * Finding the mark under a finger. A text's size depends on its font, so
 * whoever draws it says how large it is ([textBox]).
 */
object Select {
    /** The topmost shape near [p], as its index, [reach] being how far a touch may miss. */
    fun at(shapes: List<Shape>, p: Pt, reach: Float, textBox: (Shape.Text) -> Box): Int? =
        shapes.indices.reversed().firstOrNull { hits(shapes[it], p, reach, textBox) }

    /** The topmost text near [p], as its index: with the Text tool, a tap on one edits it. */
    fun textAt(shapes: List<Shape>, p: Pt, reach: Float, textBox: (Shape.Text) -> Box): Int? =
        shapes.indices.reversed().firstOrNull { shapes[it] is Shape.Text && hits(shapes[it], p, reach, textBox) }

    fun hits(shape: Shape, p: Pt, reach: Float, textBox: (Shape.Text) -> Box): Boolean = when (shape) {
        is Shape.Pen -> {
            val near = shape.width / 2 + reach
            if (shape.points.size == 1) {
                hypot(p.x - shape.points[0].x, p.y - shape.points[0].y) <= near
            } else {
                shape.points.zipWithNext().any { (a, b) -> distance(p, a, b) <= near }
            }
        }
        is Shape.Arrow -> distance(p, shape.from, shape.to) <= shape.width / 2 + reach
        // Inside counts too: a thin outline is hard to hit with a finger.
        is Shape.Rectangle -> p in shape.box.grown(shape.width / 2 + reach)
        is Shape.Blur -> p in shape.box.grown(reach)
        is Shape.Circle -> {
            val rx = shape.box.width / 2 + shape.width / 2 + reach
            val ry = shape.box.height / 2 + shape.width / 2 + reach
            val x = (p.x - (shape.box.left + shape.box.right) / 2) / rx
            val y = (p.y - (shape.box.top + shape.box.bottom) / 2) / ry
            x * x + y * y <= 1f
        }
        is Shape.Text -> p in textBox(shape).grown(reach)
    }

    /** The frame drawn around a selected shape. */
    fun bounds(shape: Shape, textBox: (Shape.Text) -> Box): Box = when (shape) {
        is Shape.Pen -> Box(
            shape.points.minOf { it.x }, shape.points.minOf { it.y },
            shape.points.maxOf { it.x }, shape.points.maxOf { it.y },
        ).grown(shape.width / 2)
        is Shape.Arrow -> Box.of(shape.from, shape.to).grown(shape.width * 2 + 6)
        is Shape.Rectangle -> shape.box.grown(shape.width / 2)
        is Shape.Circle -> shape.box.grown(shape.width / 2)
        is Shape.Blur -> shape.box
        is Shape.Text -> textBox(shape)
    }

    /** How far [p] is from the segment [a]-[b]. */
    internal fun distance(p: Pt, a: Pt, b: Pt): Float {
        val dx = b.x - a.x
        val dy = b.y - a.y
        val length = dx * dx + dy * dy
        val t = if (length == 0f) 0f else (((p.x - a.x) * dx + (p.y - a.y) * dy) / length).coerceIn(0f, 1f)
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }
}

/** What a finger can pull on a selected shape to resize it. */
sealed interface Grip {
    /** A corner of the shape's frame. */
    data class Corner(val handle: Handle) : Grip

    /** An arrow's tail or tip. */
    data object From : Grip
    data object To : Grip
}

object Resize {
    private val everywhere = Box(-1e9f, -1e9f, 1e9f, 1e9f)

    /** The handles of [shape] and where they sit. A text has one, to make it larger or smaller. */
    fun grips(shape: Shape, textBox: (Shape.Text) -> Box): List<Pair<Grip, Pt>> = when (shape) {
        is Shape.Arrow -> listOf(Grip.From to shape.from, Grip.To to shape.to)
        is Shape.Text -> textBox(shape).let { listOf(Grip.Corner(Handle.BOTTOM_RIGHT) to Pt(it.right, it.bottom)) }
        else -> frame(shape, textBox).let { b ->
            listOf(
                Grip.Corner(Handle.TOP_LEFT) to Pt(b.left, b.top),
                Grip.Corner(Handle.TOP_RIGHT) to Pt(b.right, b.top),
                Grip.Corner(Handle.BOTTOM_LEFT) to Pt(b.left, b.bottom),
                Grip.Corner(Handle.BOTTOM_RIGHT) to Pt(b.right, b.bottom),
            )
        }
    }

    /** The handle within [reach] of [p], the nearest one if several are. */
    fun gripAt(shape: Shape, p: Pt, reach: Float, textBox: (Shape.Text) -> Box): Grip? =
        grips(shape, textBox)
            .map { (grip, at) -> grip to hypot(p.x - at.x, p.y - at.y) }
            .filter { it.second <= reach }
            .minByOrNull { it.second }
            ?.first

    /** [shape] with [grip] pulled by ([dx], [dy]), never smaller than [smallest]. */
    fun drag(shape: Shape, grip: Grip, dx: Float, dy: Float, smallest: Float, textBox: (Shape.Text) -> Box): Shape {
        if (shape is Shape.Arrow) {
            return when (grip) {
                Grip.From -> shape.copy(from = Pt(shape.from.x + dx, shape.from.y + dy))
                Grip.To -> shape.copy(to = Pt(shape.to.x + dx, shape.to.y + dy))
                is Grip.Corner -> shape
            }
        }
        val corner = (grip as? Grip.Corner)?.handle ?: return shape
        val old = frame(shape, textBox)
        val new = Crop.drag(old, corner, dx, dy, everywhere, smallest)
        return when (shape) {
            is Shape.Rectangle -> shape.copy(box = new)
            is Shape.Circle -> shape.copy(box = new)
            is Shape.Blur -> shape.copy(box = new)
            is Shape.Pen -> shape.copy(points = shape.points.map { scale(it, old, new) })
            is Shape.Text -> {
                // The text grows from its top left corner, by how much the corner moved on average.
                val factor = ((new.width / old.width) + (new.height / old.height)) / 2
                shape.copy(size = (shape.size * factor).coerceAtLeast(smallest / 2))
            }
            is Shape.Arrow -> shape
        }
    }

    /** The frame the corners pull: the shape itself, without its stroke. */
    private fun frame(shape: Shape, textBox: (Shape.Text) -> Box): Box = when (shape) {
        is Shape.Rectangle -> shape.box
        is Shape.Circle -> shape.box
        is Shape.Blur -> shape.box
        is Shape.Pen -> Box(
            shape.points.minOf { it.x }, shape.points.minOf { it.y },
            shape.points.maxOf { it.x }, shape.points.maxOf { it.y },
        )
        is Shape.Text -> textBox(shape)
        is Shape.Arrow -> Box.of(shape.from, shape.to)
    }

    /** [p] placed in [new] where it was in [old]. A flat stroke stays flat. */
    private fun scale(p: Pt, old: Box, new: Box) = Pt(
        if (old.width == 0f) p.x + (new.left - old.left) else new.left + (p.x - old.left) * new.width / old.width,
        if (old.height == 0f) p.y + (new.top - old.top) else new.top + (p.y - old.top) * new.height / old.height,
    )
}

/** The colour of a mark; a blur has none. */
val Shape.color: Int?
    get() = when (this) {
        is Shape.Pen -> color
        is Shape.Rectangle -> color
        is Shape.Circle -> color
        is Shape.Arrow -> color
        is Shape.Text -> color
        is Shape.Blur -> null
    }

fun Shape.recolored(color: Int): Shape = when (this) {
    is Shape.Pen -> copy(color = color)
    is Shape.Rectangle -> copy(color = color)
    is Shape.Circle -> copy(color = color)
    is Shape.Arrow -> copy(color = color)
    is Shape.Text -> copy(color = color)
    is Shape.Blur -> this
}

/**
 * The thickness a mark was drawn with: its line, its text size or how much
 * it blurs. A text resized by hand gets the nearest one.
 */
fun Shape.stroke(sizes: Sizes): Stroke {
    val (value, of) = when (this) {
        is Shape.Pen -> width to sizes::line
        is Shape.Rectangle -> width to sizes::line
        is Shape.Circle -> width to sizes::line
        is Shape.Arrow -> width to sizes::line
        is Shape.Text -> size to sizes::text
        is Shape.Blur -> cell to sizes::blur
    }
    return Stroke.entries.minBy { abs(of(it) - value) }
}

fun Shape.restroked(stroke: Stroke, sizes: Sizes): Shape = when (this) {
    is Shape.Pen -> copy(width = sizes.line(stroke))
    is Shape.Rectangle -> copy(width = sizes.line(stroke))
    is Shape.Circle -> copy(width = sizes.line(stroke))
    is Shape.Arrow -> copy(width = sizes.line(stroke))
    is Shape.Text -> copy(size = sizes.text(stroke))
    is Shape.Blur -> copy(cell = sizes.blur(stroke))
}

/**
 * How far two fingers zoomed in, and where they moved the view, in screen
 * pixels around the centre of a [width] x [height] view. At 1 the image fits.
 */
data class Zoom(val scale: Float = 1f, val panX: Float = 0f, val panY: Float = 0f) {
    val zoomedIn get() = scale > 1f

    /** [fit] seen through this zoom. */
    fun apply(fit: Fit, width: Float, height: Float): Fit {
        val cx = width / 2
        val cy = height / 2
        return fit.copy(
            scale = fit.scale * scale,
            offsetX = cx + (fit.offsetX - cx) * scale + panX,
            offsetY = cy + (fit.offsetY - cy) * scale + panY,
        )
    }

    /**
     * Fingers centred on ([x], [y]) spread by [factor] and moved by
     * ([dx], [dy]): what was under them stays under them.
     */
    fun pinched(factor: Float, x: Float, y: Float, dx: Float, dy: Float, width: Float, height: Float): Zoom {
        val next = (scale * factor).coerceIn(1f, MAX)
        if (next <= SNAP) return Zoom()
        val cx = width / 2
        val cy = height / 2
        // The point under the fingers, before any zoom.
        val ux = (x - cx - panX) / scale + cx
        val uy = (y - cy - panY) / scale + cy
        val limitX = (next - 1) * width / 2
        val limitY = (next - 1) * height / 2
        return Zoom(
            next,
            (x + dx - cx - (ux - cx) * next).coerceIn(-limitX, limitX),
            (y + dy - cy - (uy - cy) * next).coerceIn(-limitY, limitY),
        )
    }

    private companion object {
        const val MAX = 8f

        /** Close enough to 1 to fit again, so that pinching back always gets there. */
        const val SNAP = 1.05f
    }
}
