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

    @Test
    fun aPinchKeepsWhatIsUnderTheFingers() {
        val fit = Fit.of(Box.of(1000, 1000), width = 1000f, height = 1000f, margin = 0f)
        val zoom = Zoom().pinched(2f, x = 250f, y = 250f, dx = 0f, dy = 0f, width = 1000f, height = 1000f)
        assertEquals(2f, zoom.scale)
        val zoomed = zoom.apply(fit, 1000f, 1000f)
        val under = zoomed.toImage(250f, 250f)
        assertEquals(250f, under.x, 0.01f)
        assertEquals(250f, under.y, 0.01f)
    }

    @Test
    fun pinchingBackFitsTheImageAgain() {
        val zoom = Zoom(3f, 400f, -200f).pinched(0.34f, x = 500f, y = 500f, dx = 0f, dy = 0f, width = 1000f, height = 1000f)
        assertEquals(Zoom(), zoom)
        assertFalse(zoom.zoomedIn)
    }

    @Test
    fun theViewCannotBeDraggedAwayFromTheImage() {
        val zoom = Zoom(2f).pinched(1f, x = 500f, y = 500f, dx = 5000f, dy = 0f, width = 1000f, height = 1000f)
        assertEquals(500f, zoom.panX)
        assertEquals(8f, Zoom(6f).pinched(4f, 500f, 500f, 0f, 0f, 1000f, 1000f).scale)
    }

    @Test
    fun aQuarterTurnTurnsTheMarksAndTheCrop() {
        val picture = Picture(
            listOf(
                Shape.Rectangle(Box(100f, 200f, 300f, 250f), red, 12f),
                Shape.Arrow(Pt(0f, 0f), Pt(100f, 0f), red, 12f),
            ),
            crop = Box(0f, 0f, 1080f, 1200f),
        )
        val turned = picture.turned(1080f, 2400f, noText)
        assertEquals(1, turned.turns)
        assertEquals(Box(2150f, 100f, 2200f, 300f), (turned.shapes[0] as Shape.Rectangle).box)
        assertEquals(Pt(2400f, 0f), (turned.shapes[1] as Shape.Arrow).from)
        assertEquals(Pt(2400f, 100f), (turned.shapes[1] as Shape.Arrow).to)
        assertEquals(Box(1200f, 0f, 2400f, 1080f), turned.crop)
    }

    @Test
    fun fourQuarterTurnsGiveTheSamePicture() {
        val text = Shape.Text(Pt(40f, 60f), "Here", red, 40f)
        val picture = Picture(
            listOf(Shape.Pen(listOf(Pt(1f, 2f), Pt(30f, 40f)), red, 12f), text, Shape.Blur(Box(5f, 5f, 50f, 80f), 6f)),
            crop = Box(10f, 20f, 900f, 2000f),
        )
        var turned = picture
        var width = 1080f
        var height = 2400f
        repeat(4) {
            turned = turned.turned(width, height, noText)
            width = height.also { height = width }
        }
        assertEquals(picture, turned)
    }

    @Test
    fun aTurnedTextStaysLevelAroundItsMiddle() {
        val text = Shape.Text(Pt(0f, 0f), "Here", red, 40f)
        // The test's text box is 100 x 40: its middle (50, 20) goes to (2380, 50).
        val turned = Picture(listOf(text), Box.of(1080, 2400)).turned(1080f, 2400f, noText).shapes[0] as Shape.Text
        assertEquals(Pt(2330f, 30f), turned.at)
        assertEquals(40f, turned.size)
    }

    @Test
    fun aTurnLeftUndoesATurnRight() {
        val picture = Picture(
            listOf(Shape.Arrow(Pt(10f, 20f), Pt(300f, 400f), red, 12f), Shape.Text(Pt(40f, 60f), "Here", red, 40f)),
            crop = Box(10f, 20f, 900f, 2000f),
        )
        val left = picture.turnedLeft(1080f, 2400f, noText)
        assertEquals(3, left.turns)
        assertEquals(Pt(20f, 1070f), (left.shapes[0] as Shape.Arrow).from)
        assertEquals(picture, left.turned(2400f, 1080f, noText).copy(turns = 0))
    }

    @Test
    fun aFlipMirrorsTheMarksAndTheCropButNotTheText() {
        val picture = Picture(
            listOf(Shape.Rectangle(Box(100f, 200f, 300f, 250f), red, 12f), Shape.Text(Pt(40f, 60f), "Here", red, 40f)),
            crop = Box(0f, 0f, 800f, 2400f),
        )
        val flipped = picture.flippedOver(1080f, noText)
        assertTrue(flipped.flipped)
        assertEquals(Box(780f, 200f, 980f, 250f), (flipped.shapes[0] as Shape.Rectangle).box)
        // The test's text box is 100 wide: from 40-140 it goes to 940-1040, still left to right.
        assertEquals(Pt(940f, 60f), (flipped.shapes[1] as Shape.Text).at)
        assertEquals(Box(280f, 0f, 1080f, 2400f), flipped.crop)
        assertEquals(picture, flipped.flippedOver(1080f, noText))
    }

    @Test
    fun turningAMirroredImageTurnsTheOriginalTheOtherWay() {
        val flipped = Picture.blank(1080, 2400).flippedOver(1080f, noText)
        assertEquals(3, flipped.turned(1080f, 2400f, noText).turns)
        assertEquals(1, flipped.turnedLeft(1080f, 2400f, noText).turns)
    }

    @Test
    fun aVerticalFlipMirrorsTopToBottom() {
        val picture = Picture(
            listOf(Shape.Rectangle(Box(100f, 200f, 300f, 250f), red, 12f), Shape.Text(Pt(40f, 60f), "Here", red, 40f)),
            crop = Box(0f, 0f, 1080f, 2000f),
        )
        val flipped = picture.flippedUpsideDown(1080f, 2400f, noText)
        assertEquals(Box(100f, 2150f, 300f, 2200f), (flipped.shapes[0] as Shape.Rectangle).box)
        // The test's text box is 40 high: from 60-100 it goes to 2300-2340, still the right way up.
        assertEquals(Pt(40f, 2300f), (flipped.shapes[1] as Shape.Text).at)
        assertEquals(Box(0f, 400f, 1080f, 2400f), flipped.crop)
        assertEquals(picture, flipped.flippedUpsideDown(1080f, 2400f, noText))
    }

    @Test
    fun aTiltedImageNeedsALargerFrame() {
        val (width, height) = Tilt.size(1000f, 500f, 90f)
        assertEquals(500f, width, 0.01f)
        assertEquals(1000f, height, 0.01f)
        val (w45, h45) = Tilt.size(1000f, 1000f, 45f)
        assertEquals(1414.2f, w45, 0.1f)
        assertEquals(1414.2f, h45, 0.1f)
        assertEquals(Box(0f, 0f, 1000f, 500f), Tilt.inner(1000f, 500f, 0f))
    }

    @Test
    fun theCropOfATiltedImageHasNoEmptyCorner() {
        // A square tilted 45 degrees: the largest square inside is half its area, centred.
        val crop = Tilt.inner(1000f, 1000f, 45f)
        assertEquals(707.1f, crop.width, 0.1f)
        assertEquals((1414.2f - 707.1f) / 2, crop.left, 0.1f)
    }

    @Test
    fun aTiltKeepsTheMarksOnTheImageAndGoesBack() {
        val picture = Picture(
            listOf(
                Shape.Arrow(Pt(100f, 100f), Pt(500f, 300f), red, 12f),
                Shape.Rectangle(Box(200f, 1000f, 400f, 1100f), red, 12f),
                Shape.Text(Pt(40f, 60f), "Here", red, 40f),
            ),
            crop = Box.of(1080, 2400),
        )
        val tilted = picture.angled(10f, 1080f, 2400f, noText)
        assertEquals(10f, tilted.angle)
        val back = tilted.angled(0f, 1080f, 2400f, noText)
        val arrow = back.shapes[0] as Shape.Arrow
        assertEquals(100f, arrow.from.x, 0.01f)
        assertEquals(300f, arrow.to.y, 0.01f)
        assertEquals(200f, (back.shapes[1] as Shape.Rectangle).box.left, 0.01f)
        assertEquals(60f, (back.shapes[2] as Shape.Text).at.y, 0.01f)
        assertEquals(Box.of(1080, 2400), back.crop)
    }

    @Test
    fun aMirrorTiltsTheOtherWayAndATurnKeepsTheTilt() {
        val tilted = Picture.blank(1080, 2400).angled(12f, 1080f, 2400f, noText)
        val (width, height) = Tilt.size(1080f, 2400f, 12f)
        assertEquals(-12f, tilted.flippedOver(width, noText).angle)
        assertEquals(12f, tilted.turned(width, height, noText).angle)
    }

    @Test
    fun aBlurStillCoversWhatItHidAfterATilt() {
        val blur = Shape.Blur(Box(100f, 100f, 300f, 140f), 6f)
        val tilted = Picture(listOf(blur), Box.of(1080, 2400)).angled(20f, 1080f, 2400f, noText).shapes[0] as Shape.Blur
        val (w, h) = Tilt.size(200f, 40f, 20f)
        assertEquals(w, tilted.box.width, 0.01f)
        assertEquals(h, tilted.box.height, 0.01f)
        assertTrue(tilted.box.width > 200f && tilted.box.height > 40f)
    }

    @Test
    fun aTiltNeverBringsBackWhatTheCropLeftOut() {
        val cropped = Picture(emptyList(), Box(100f, 300f, 700f, 900f))
        val tilted = cropped.angled(15f, 1080f, 2400f, noText)
        // Back at 0 degrees, the crop must lie inside the first one: nothing outside it shows again.
        val back = tilted.angled(0f, 1080f, 2400f, noText).crop
        assertTrue(back.left >= 100f - 0.01f && back.top >= 300f - 0.01f)
        assertTrue(back.right <= 700f + 0.01f && back.bottom <= 900f + 0.01f)
        assertTrue(back.width > 0f && back.height > 0f)
    }

    @Test
    fun anUncroppedImageGetsTheWholeFrameWithNoEmptyCorner() {
        val tilted = Picture.blank(1080, 2400).angled(15f, 1080f, 2400f, noText)
        assertEquals(Tilt.inner(1080f, 2400f, 15f), tilted.crop)
        assertEquals(Box.of(1080, 2400), tilted.angled(0f, 1080f, 2400f, noText).crop)
    }

    @Test
    fun aRatioGivesTheLargestFrameOfThatShape() {
        val square = Crop.withRatio(1f, around = image, bounds = image)
        assertEquals(Box(0f, 660f, 1080f, 1740f), square)
        val wide = Crop.withRatio(16f / 9f, around = Box(0f, 0f, 1080f, 600f), bounds = image)
        assertEquals(1080f, wide.width, 0.01f)
        assertEquals(607.5f, wide.height, 0.01f)
        assertEquals(0f, wide.top, 0.01f)
    }

    @Test
    fun aCornerKeepsTheRatioAndTheOppositeCorner() {
        val start = Box(100f, 100f, 500f, 400f)
        val crop = Crop.drag(start, Handle.BOTTOM_RIGHT, 200f, 0f, image, 72f, 4f / 3f)
        assertEquals(Box(100f, 100f, 700f, 550f), crop)
        val far = Crop.drag(start, Handle.BOTTOM_RIGHT, 5000f, 5000f, image, 72f, 4f / 3f)
        assertEquals(1080f, far.right, 0.01f)
        assertEquals(4f / 3f, far.width / far.height, 0.001f)
    }

    @Test
    fun anEdgeKeepsTheRatioAndStaysCentred() {
        val start = Box(100f, 100f, 500f, 400f)
        val crop = Crop.drag(start, Handle.RIGHT, 100f, 0f, image, 72f, 4f / 3f)
        assertEquals(500f, crop.width, 0.01f)
        assertEquals(375f, crop.height, 0.01f)
        assertEquals(250f, (crop.top + crop.bottom) / 2, 0.01f)
        assertEquals(100f, crop.left, 0.01f)
    }

    @Test
    fun lightLeavesTheImageAloneAtZero() {
        val matrix = Light.matrix(0, 0)
        assertEquals(1f, matrix[0])
        assertEquals(0f, matrix[4])
        assertEquals(1f, matrix[18])
    }

    @Test
    fun brightnessAddsAndContrastSpreadsAroundMidGrey() {
        assertEquals(50f, Light.matrix(50, 0)[4])
        val strong = Light.matrix(0, 100)
        assertEquals(2f, strong[0])
        // Mid grey stays where it is: 128 x 2 - 128 = 128.
        assertEquals(128f, 128 * strong[0] + strong[4])
        val soft = Light.matrix(0, -100)
        assertEquals(0.2f, soft[0], 0.0001f)
        assertEquals(1f, soft[18])
    }

    @Test
    fun turnsMirrorsAndTiltsKeepTheLight() {
        val lit = Picture.blank(1080, 2400).copy(brightness = 30, contrast = -20)
        val turned = lit.turned(1080f, 2400f, noText).flippedOver(2400f, noText).angled(5f, 2400f, 1080f, noText)
        assertEquals(30, turned.brightness)
        assertEquals(-20, turned.contrast)
    }
}
