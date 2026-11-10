package com.snap2link.app.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PictureTest {
    private val image = Box.of(1080, 2400)
    private val red = Palette[0]

    @Test
    fun undoAndRedoWalkThroughThePictures() {
        val start = Picture.blank(1080, 2400)
        val marked = start.copy(shapes = listOf(Shape.Arrow(Pt(0f, 0f), Pt(100f, 100f), red, 12f)))
        val cropped = marked.copy(crop = Box(0f, 0f, 500f, 500f))
        var edits = Edits(start).then(marked).then(cropped)

        edits = edits.undo()
        assertEquals(marked, edits.now)
        edits = edits.undo()
        assertEquals(start, edits.now)
        assertFalse(edits.canUndo)
        edits = edits.redo().redo()
        assertEquals(cropped, edits.now)
        assertFalse(edits.canRedo)
    }

    @Test
    fun aNewEditForgetsWhatCouldBeRedone() {
        val start = Picture.blank(10, 10)
        val a = start.copy(crop = Box(0f, 0f, 5f, 5f))
        val b = start.copy(crop = Box(0f, 0f, 8f, 8f))
        val edits = Edits(start).then(a).undo().then(b)
        assertEquals(b, edits.now)
        assertFalse(edits.canRedo)
    }

    @Test
    fun theSamePictureAddsNoStep() {
        val edits = Edits(Picture.blank(10, 10))
        assertSame(edits, edits.then(Picture.blank(10, 10)))
    }

    @Test
    fun historyKeepsFiftySteps() {
        var edits = Edits(Picture.blank(1000, 1000))
        for (i in 1..80) edits = edits.then(Picture(emptyList(), Box(0f, 0f, i.toFloat(), i.toFloat())))
        assertEquals(50, edits.past.size)
    }

    @Test
    fun cornersAreGrabbedBeforeEdges() {
        val crop = Box(100f, 100f, 900f, 1900f)
        assertEquals(Handle.TOP_LEFT, Crop.handleAt(crop, Pt(110f, 95f), reach = 40f))
        assertEquals(Handle.BOTTOM_RIGHT, Crop.handleAt(crop, Pt(905f, 1890f), reach = 40f))
        assertEquals(Handle.LEFT, Crop.handleAt(crop, Pt(90f, 1000f), reach = 40f))
        assertEquals(Handle.BOTTOM, Crop.handleAt(crop, Pt(500f, 1910f), reach = 40f))
        assertEquals(Handle.MOVE, Crop.handleAt(crop, Pt(500f, 1000f), reach = 40f))
        assertNull(Crop.handleAt(crop, Pt(10f, 10f), reach = 40f))
    }

    @Test
    fun aCornerDragStaysInsideTheImage() {
        val crop = Crop.drag(image, Handle.TOP_LEFT, dx = -50f, dy = 300f, bounds = image, smallest = 72f)
        assertEquals(Box(0f, 300f, 1080f, 2400f), crop)
    }

    @Test
    fun theCropNeverGetsTooSmall() {
        val crop = Crop.drag(Box(0f, 0f, 500f, 500f), Handle.RIGHT, dx = -1000f, dy = 0f, bounds = image, smallest = 72f)
        assertEquals(72f, crop.width)
    }

    @Test
    fun movingTheCropKeepsItsSize() {
        val crop = Crop.drag(Box(100f, 100f, 600f, 600f), Handle.MOVE, dx = 1000f, dy = -500f, bounds = image, smallest = 72f)
        assertEquals(Box(580f, 0f, 1080f, 500f), crop)
    }

    @Test
    fun fitCentresTheImageAndMapsBack() {
        val fit = Fit.of(image, width = 1080f, height = 1200f, margin = 0f)
        assertEquals(0.5f, fit.scale)
        assertEquals(270f, fit.offsetX)
        assertEquals(Pt(540f, 1200f), fit.toImage(540f, 600f))
        assertEquals(540f, fit.toViewX(540f))
    }

    @Test
    fun sizesFollowTheImage() {
        assertEquals(12f, Sizes(1080, 2400).line(Stroke.MEDIUM))
        assertEquals(1f, Sizes(100, 100).unit)
    }

    @Test
    fun slipsOfTheFingerAreDropped() {
        val sizes = Sizes(1080, 2400)
        assertFalse(Shape.Rectangle(Box(0f, 0f, 3f, 3f), red, 12f).isWorthKeeping(sizes))
        assertTrue(Shape.Rectangle(Box(0f, 0f, 200f, 5f), red, 12f).isWorthKeeping(sizes))
        assertFalse(Shape.Blur(Box(0f, 0f, 200f, 5f), 18f).isWorthKeeping(sizes))
        assertFalse(Shape.Pen(listOf(Pt(1f, 1f)), red, 12f).isWorthKeeping(sizes))
    }

    @Test
    fun drawingStaysInsideTheCrop() {
        assertEquals(Pt(100f, 500f), Pt(-20f, 900f).inside(Box(100f, 0f, 600f, 500f)))
    }

    private val noText: (Shape.Text) -> Box = { Box(it.at.x, it.at.y, it.at.x + 100f, it.at.y + 40f) }

    @Test
    fun theTopmostShapeUnderTheFingerIsSelected() {
        val under = Shape.Rectangle(Box(100f, 100f, 500f, 500f), red, 12f)
        val over = Shape.Circle(Box(200f, 200f, 400f, 400f), red, 12f)
        assertEquals(1, Select.at(listOf(under, over), Pt(300f, 300f), reach = 20f, textBox = noText))
        assertEquals(0, Select.at(listOf(under, over), Pt(120f, 480f), reach = 20f, textBox = noText))
        assertNull(Select.at(listOf(under, over), Pt(900f, 900f), reach = 20f, textBox = noText))
    }

    @Test
    fun linesAreHitNearTheirPath() {
        val arrow = Shape.Arrow(Pt(0f, 0f), Pt(1000f, 0f), red, 12f)
        assertTrue(Select.hits(arrow, Pt(500f, 20f), reach = 20f, textBox = noText))
        assertFalse(Select.hits(arrow, Pt(500f, 60f), reach = 20f, textBox = noText))
        assertFalse(Select.hits(arrow, Pt(1100f, 0f), reach = 20f, textBox = noText))
        val pen = Shape.Pen(listOf(Pt(0f, 0f), Pt(100f, 100f), Pt(200f, 0f)), red, 12f)
        assertTrue(Select.hits(pen, Pt(150f, 55f), reach = 10f, textBox = noText))
        assertFalse(Select.hits(pen, Pt(100f, 0f), reach = 10f, textBox = noText))
    }

    @Test
    fun aCircleIsHitInsideButNotInItsCorners() {
        val circle = Shape.Circle(Box(0f, 0f, 200f, 200f), red, 4f)
        assertTrue(Select.hits(circle, Pt(100f, 100f), reach = 10f, textBox = noText))
        assertFalse(Select.hits(circle, Pt(5f, 5f), reach = 10f, textBox = noText))
    }

    @Test
    fun aTextIsHitWhereItIsDrawn() {
        val text = Shape.Text(Pt(50f, 50f), "Here", red, 40f)
        assertTrue(Select.hits(text, Pt(120f, 70f), reach = 0f, textBox = noText))
        assertFalse(Select.hits(text, Pt(200f, 70f), reach = 0f, textBox = noText))
    }

    @Test
    fun movingAShapeMovesAllOfIt() {
        val pen = Shape.Pen(listOf(Pt(0f, 0f), Pt(10f, 20f)), red, 12f).moved(5f, -5f) as Shape.Pen
        assertEquals(listOf(Pt(5f, -5f), Pt(15f, 15f)), pen.points)
        val arrow = Shape.Arrow(Pt(0f, 0f), Pt(10f, 10f), red, 12f).moved(1f, 2f) as Shape.Arrow
        assertEquals(Pt(1f, 2f), arrow.from)
        assertEquals(Pt(11f, 12f), arrow.to)
        assertEquals(Box(10f, 10f, 20f, 20f), (Shape.Blur(Box(0f, 0f, 10f, 10f), 6f).moved(10f, 10f) as Shape.Blur).box)
    }

    @Test
    fun aCornerResizesARectangleFromTheOppositeOne() {
        val rect = Shape.Rectangle(Box(100f, 100f, 300f, 300f), red, 12f)
        val grip = Resize.gripAt(rect, Pt(305f, 295f), reach = 20f, textBox = noText)
        assertEquals(Grip.Corner(Handle.BOTTOM_RIGHT), grip)
        val bigger = Resize.drag(rect, grip!!, 100f, 50f, smallest = 16f, textBox = noText) as Shape.Rectangle
        assertEquals(Box(100f, 100f, 400f, 350f), bigger.box)
    }

    @Test
    fun aShapeNeverShrinksToNothing() {
        val circle = Shape.Circle(Box(0f, 0f, 100f, 100f), red, 12f)
        val small = Resize.drag(circle, Grip.Corner(Handle.TOP_LEFT), 500f, 500f, smallest = 16f, textBox = noText) as Shape.Circle
        assertEquals(Box(84f, 84f, 100f, 100f), small.box)
    }

    @Test
    fun anArrowEndMovesAlone() {
        val arrow = Shape.Arrow(Pt(0f, 0f), Pt(100f, 100f), red, 12f)
        assertEquals(Grip.To, Resize.gripAt(arrow, Pt(95f, 98f), reach = 20f, textBox = noText))
        val moved = Resize.drag(arrow, Grip.To, 50f, 0f, smallest = 16f, textBox = noText) as Shape.Arrow
        assertEquals(Pt(0f, 0f), moved.from)
        assertEquals(Pt(150f, 100f), moved.to)
    }

    @Test
    fun aPenStrokeStretchesWithItsFrame() {
        val pen = Shape.Pen(listOf(Pt(0f, 0f), Pt(50f, 100f), Pt(100f, 0f)), red, 12f)
        val wide = Resize.drag(pen, Grip.Corner(Handle.BOTTOM_RIGHT), 100f, 0f, smallest = 16f, textBox = noText) as Shape.Pen
        assertEquals(listOf(Pt(0f, 0f), Pt(100f, 100f), Pt(200f, 0f)), wide.points)
    }

    @Test
    fun aTextGrowsFromItsCorner() {
        val text = Shape.Text(Pt(0f, 0f), "Here", red, 40f)
        assertEquals(1, Resize.grips(text, noText).size)
        val larger = Resize.drag(text, Grip.Corner(Handle.BOTTOM_RIGHT), 100f, 40f, smallest = 16f, textBox = noText) as Shape.Text
        assertEquals(80f, larger.size)
        assertEquals(Pt(0f, 0f), larger.at)
    }

    @Test
    fun aMarkTakesANewColourButABlurHasNone() {
        val blue = Palette[3]
        val arrow = Shape.Arrow(Pt(0f, 0f), Pt(10f, 10f), red, 12f)
        assertEquals(red, arrow.color)
        assertEquals(blue, arrow.recolored(blue).color)
        assertEquals(arrow.from, (arrow.recolored(blue) as Shape.Arrow).from)
        val blur = Shape.Blur(Box(0f, 0f, 10f, 10f), 6f)
        assertNull(blur.color)
        assertSame(blur, blur.recolored(blue))
    }

    @Test
    fun aMarkTakesANewThickness() {
        val sizes = Sizes(1080, 2400)
        val arrow = Shape.Arrow(Pt(0f, 0f), Pt(10f, 10f), red, sizes.line(Stroke.MEDIUM))
        assertEquals(Stroke.MEDIUM, arrow.stroke(sizes))
        assertEquals(sizes.line(Stroke.THICK), (arrow.restroked(Stroke.THICK, sizes) as Shape.Arrow).width)
        val blur = Shape.Blur(Box(0f, 0f, 10f, 10f), sizes.blur(Stroke.THIN))
        assertEquals(sizes.blur(Stroke.THICK), (blur.restroked(Stroke.THICK, sizes) as Shape.Blur).cell)
    }

    @Test
    fun aTextResizedByHandHasTheNearestThickness() {
        val sizes = Sizes(1080, 2400)
        val text = Shape.Text(Pt(0f, 0f), "Here", red, sizes.text(Stroke.THICK) * 0.95f)
        assertEquals(Stroke.THICK, text.stroke(sizes))
        assertEquals(sizes.text(Stroke.THIN), (text.restroked(Stroke.THIN, sizes) as Shape.Text).size)
    }

    @Test
    fun theTextToolFindsATextEvenUnderAnotherMark() {
        val text = Shape.Text(Pt(50f, 50f), "Here", red, 40f)
        val box = Shape.Rectangle(Box(0f, 0f, 300f, 300f), red, 12f)
        val shapes = listOf(text, box)
        assertEquals(1, Select.at(shapes, Pt(70f, 70f), reach = 0f, textBox = noText))
        assertEquals(0, Select.textAt(shapes, Pt(70f, 70f), reach = 0f, textBox = noText))
        assertNull(Select.textAt(shapes, Pt(250f, 250f), reach = 0f, textBox = noText))
    }
}
