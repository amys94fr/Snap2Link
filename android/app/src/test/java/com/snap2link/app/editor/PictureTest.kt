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
}
