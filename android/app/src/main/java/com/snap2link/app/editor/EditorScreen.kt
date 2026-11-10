package com.snap2link.app.editor

import android.app.Activity
import androidx.core.content.edit
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.widthIn
import android.content.Context
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke as DrawStroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.core.graphics.withClip
import androidx.core.view.WindowCompat
import com.snap2link.app.R
import com.snap2link.app.ui.Snap2LinkTheme
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.roundToInt

/** Crop and mark up a screenshot before it is sent, as the desktop annotator does. */
@Composable
fun EditorScreen(
    renderer: Renderer,
    edits: Edits,
    onEdit: (Edits) -> Unit,
    onCancel: () -> Unit,
    onSend: () -> Unit,
) {
    val sizes = remember(renderer) { Sizes(renderer.source.width, renderer.source.height) }
    var tool by rememberSaveable { mutableStateOf(Tool.CROP) }
    var colorIndex by rememberSaveable { mutableIntStateOf(0) }
    var stroke by rememberSaveable { mutableStateOf(Stroke.MEDIUM) }
    var writing by remember { mutableStateOf<Writing?>(null) }
    var selected by remember { mutableStateOf<Int?>(null) }
    var tilting by remember { mutableStateOf<Float?>(null) }
    val baseWidth = renderer.width(edits.now.turns).toFloat()
    val baseHeight = renderer.height(edits.now.turns).toFloat()
    val preview = tilting?.let { edits.now.angled(it, baseWidth, baseHeight, renderer::textBox) }
    val color = Palette[colorIndex]
    // An undo can remove the selected shape: the selection only holds while it points at one.
    val chosen = selected?.takeIf { tool == Tool.SELECT && it in edits.now.shapes.indices }

    // Light status bar icons on the dark editor, and back as they were when it closes.
    // The two-finger swipe can't be seen: a tip says so the first time, and never again.
    val context = LocalContext.current
    var tip by remember { mutableStateOf(!SwipeTip.seen(context)) }
    LaunchedEffect(Unit) { if (tip) SwipeTip.markSeen(context) }
    val view = LocalView.current
    DisposableEffect(view) {
        val window = (view.context as? Activity)?.window
        val bars = window?.let { WindowCompat.getInsetsController(it, view) }
        val light = bars?.isAppearanceLightStatusBars
        bars?.isAppearanceLightStatusBars = false
        bars?.isAppearanceLightNavigationBars = false
        onDispose {
            if (light != null) {
                bars.isAppearanceLightStatusBars = light
                bars.isAppearanceLightNavigationBars = light
            }
        }
    }

    Snap2LinkTheme(dark = true) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().systemBarsPadding()) {
                TopBar(
                    edits = edits,
                    onHistory = {
                        selected = null
                        onEdit(it)
                    },
                    onCancel = onCancel,
                    onSend = onSend,
                    onDelete = chosen?.let { index ->
                        {
                            onEdit(edits.then(edits.now.copy(shapes = edits.now.shapes.filterIndexed { i, _ -> i != index })))
                            selected = null
                        }
                    },
                )
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    Board(
                        modifier = Modifier.fillMaxSize(),
                        renderer = renderer,
                        edits = edits,
                        preview = preview,
                        tool = tool,
                        color = color,
                        stroke = stroke,
                        sizes = sizes,
                        onEdit = onEdit,
                        onText = { writing = Writing.New(it) },
                        onEditText = { index, text -> writing = Writing.Existing(index, text) },
                        selected = chosen,
                        onSelect = { selected = it },
                        onUndo = {
                            selected = null
                            onEdit(edits.undo())
                        },
                        onRedo = {
                            selected = null
                            onEdit(edits.redo())
                        },
                        onSwipe = { tip = false },
                    )
                    if (tip) SwipeTipBanner(Modifier.align(Alignment.BottomCenter), onDismiss = { tip = false })
                }
                Options(
                    tool = tool,
                    colorIndex = colorIndex,
                    stroke = stroke,
                    canResetCrop = edits.now.crop != renderer.whole(edits.now),
                    onColor = { colorIndex = it },
                    onStroke = { stroke = it },
                    onRotateLeft = {
                        val (width, height) = renderer.shownSize(edits.now)
                        selected = null
                        onEdit(edits.then(edits.now.turnedLeft(width, height, renderer::textBox)))
                    },
                    onRotate = {
                        val (width, height) = renderer.shownSize(edits.now)
                        selected = null
                        onEdit(edits.then(edits.now.turned(width, height, renderer::textBox)))
                    },
                    onFlip = {
                        selected = null
                        onEdit(edits.then(edits.now.flippedOver(renderer.shownSize(edits.now).first, renderer::textBox)))
                    },
                    onFlipVertical = {
                        val (width, height) = renderer.shownSize(edits.now)
                        selected = null
                        onEdit(edits.then(edits.now.flippedUpsideDown(width, height, renderer::textBox)))
                    },
                    onResetCrop = {
                        onEdit(edits.then(edits.now.copy(crop = renderer.whole(edits.now))))
                    },
                    angle = tilting ?: edits.now.angle,
                    onTilt = { tilting = it },
                    onTiltDone = {
                        tilting?.let { degrees ->
                            selected = null
                            onEdit(edits.then(edits.now.angled(degrees, baseWidth, baseHeight, renderer::textBox)))
                        }
                        tilting = null
                    },
                    onTiltReset = {
                        selected = null
                        onEdit(edits.then(edits.now.angled(0f, baseWidth, baseHeight, renderer::textBox)))
                    },
                    selectedShape = chosen?.let { edits.now.shapes[it] },
                    onRecolor = { index ->
                        chosen?.let { i ->
                            val shapes = edits.now.shapes.mapIndexed { j, shape -> if (j == i) shape.recolored(Palette[index]) else shape }
                            onEdit(edits.then(edits.now.copy(shapes = shapes)))
                        }
                        // The next marks take the same colour.
                        colorIndex = index
                    },
                    selectedStroke = chosen?.let { edits.now.shapes[it].stroke(sizes) },
                    onRestroke = { next ->
                        chosen?.let { i ->
                            val shapes = edits.now.shapes.mapIndexed { j, shape -> if (j == i) shape.restroked(next, sizes) else shape }
                            onEdit(edits.then(edits.now.copy(shapes = shapes)))
                        }
                        // The next marks take the same thickness.
                        stroke = next
                    },
                )
                Tools(
                    tool,
                    onTool = {
                        tool = it
                        selected = null
                    },
                )
            }
        }
        writing?.let { now ->
            TextDialog(
                initial = (now as? Writing.Existing)?.text.orEmpty(),
                editing = now is Writing.Existing,
                onDismiss = { writing = null },
                onDone = { text ->
                    val shapes = when (now) {
                        is Writing.New -> edits.now.shapes + Shape.Text(now.at, text, color, sizes.text(stroke))
                        is Writing.Existing -> edits.now.shapes.mapIndexed { i, shape ->
                            if (i == now.index && shape is Shape.Text) shape.copy(text = text) else shape
                        }
                    }
                    onEdit(edits.then(edits.now.copy(shapes = shapes)))
                    writing = null
                },
            )
        }
    }
}

@Composable
private fun TopBar(
    edits: Edits,
    onHistory: (Edits) -> Unit,
    onCancel: () -> Unit,
    onSend: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    Row(
        Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onCancel) {
            Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.share_close))
        }
        Spacer(Modifier.weight(1f))
        // Only while a shape is selected: the row under the image keeps its room for colours and thickness.
        if (onDelete != null) {
            IconButton(onClick = onDelete) {
                Icon(painterResource(R.drawable.ic_trash), contentDescription = stringResource(R.string.editor_delete_shape))
            }
        }
        IconButton(onClick = { onHistory(edits.undo()) }, enabled = edits.canUndo) {
            Icon(painterResource(R.drawable.ic_undo), contentDescription = stringResource(R.string.annotator_undo))
        }
        IconButton(onClick = { onHistory(edits.redo()) }, enabled = edits.canRedo) {
            Icon(painterResource(R.drawable.ic_redo), contentDescription = stringResource(R.string.annotator_redo))
        }
        Spacer(Modifier.width(8.dp))
        Button(onClick = onSend, modifier = Modifier.heightIn(min = 48.dp).padding(end = 8.dp)) {
            Icon(painterResource(R.drawable.ic_send), contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.editor_send))
        }
    }
}

/**
 * The screenshot, where fingers crop, draw and move marks. Positions are
 * turned into image pixels at once.
 */
@Composable
private fun Board(
    modifier: Modifier,
    renderer: Renderer,
    edits: Edits,
    preview: Picture?,
    tool: Tool,
    color: Int,
    stroke: Stroke,
    sizes: Sizes,
    onEdit: (Edits) -> Unit,
    onText: (Pt) -> Unit,
    onEditText: (index: Int, text: String) -> Unit,
    selected: Int?,
    onSelect: (Int?) -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onSwipe: () -> Unit,
) {
    val picture = preview ?: edits.now
    val full = renderer.shownSize(picture).let { (width, height) -> Box(0f, 0f, width, height) }
    val density = LocalDensity.current
    val margin = with(density) { 20.dp.toPx() }
    val reach = with(density) { 28.dp.toPx() }
    var area by remember { mutableStateOf(IntSize.Zero) }
    var draft by remember { mutableStateOf<Shape?>(null) }
    var draftCrop by remember { mutableStateOf<Box?>(null) }

    /** The shape being moved, by its index, where the finger has taken it so far. */
    var moving by remember { mutableStateOf<Pair<Int, Shape>?>(null) }

    // While cropping the whole image shows; otherwise only what is kept.
    val shown = if (tool == Tool.CROP) full else picture.crop

    // Two fingers zoom in. Going in or out of cropping, or turning or mirroring the image, shows another area: the view starts over.
    var zoom by remember { mutableStateOf(Zoom()) }
    LaunchedEffect(tool == Tool.CROP, picture.turns, picture.flipped) { zoom = Zoom() }
    val fit = if (area == IntSize.Zero) {
        null
    } else {
        val width = area.width.toFloat()
        val height = area.height.toFloat()
        zoom.apply(Fit.of(shown, width, height, margin), width, height)
    }

    // Gestures outlive recompositions: they read the latest values through these.
    val latestFit by rememberUpdatedState(fit)
    val latestFull by rememberUpdatedState(full)
    val latestEdits by rememberUpdatedState(edits)
    val latestColor by rememberUpdatedState(color)
    val latestStroke by rememberUpdatedState(stroke)
    val latestSelected by rememberUpdatedState(selected)
    // Callbacks too: the gestures were set up with the first ones, which see the marks of that time.
    val latestOnText by rememberUpdatedState(onText)
    val latestOnEditText by rememberUpdatedState(onEditText)
    val latestOnSelect by rememberUpdatedState(onSelect)
    val latestOnUndo by rememberUpdatedState(onUndo)
    val latestOnRedo by rememberUpdatedState(onRedo)
    val latestOnSwipe by rememberUpdatedState(onSwipe)
    val swipe = with(density) { 48.dp.toPx() }
    val pinch = with(density) { 24.dp.toPx() }
    // Undo goes back, which is to the right in a right-to-left language, as the arrows show.
    val rightToLeft = LocalLayoutDirection.current == LayoutDirection.Rtl

    val description = stringResource(R.string.editor_board)
    Canvas(
        modifier
            .clipToBounds()
            .onSizeChanged { area = it }
            .semantics { contentDescription = description }
            // Two fingers: spread or pinched, they zoom; swiped sideways at the normal size, they
            // undo or redo. Zoomed in, they move the view instead. This runs before the other
            // gestures and takes the events from them, so a mark begun by the first finger is dropped.
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    var twoFingers = false
                    var startX = 0f
                    var startY = 0f
                    var startSpread = 0f
                    var lastX = 0f
                    var lastY = 0f
                    var lastSpread = 0f
                    var zooming = false
                    var done = false
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        val down = event.changes.filter { it.pressed }
                        if (down.isEmpty()) break
                        if (down.size >= 2) {
                            val x = (down[0].position.x + down[1].position.x) / 2
                            val y = (down[0].position.y + down[1].position.y) / 2
                            val spread = (down[0].position - down[1].position).getDistance()
                            if (!twoFingers) {
                                twoFingers = true
                                startX = x
                                startY = y
                                startSpread = spread
                                lastX = x
                                lastY = y
                                lastSpread = spread
                                zooming = zoom.zoomedIn
                            }
                            if (!zooming && !done && abs(spread - startSpread) > pinch) zooming = true
                            if (zooming) {
                                val factor = if (lastSpread > 0f) spread / lastSpread else 1f
                                zoom = zoom.pinched(factor, lastX, lastY, x - lastX, y - lastY, size.width.toFloat(), size.height.toFloat())
                            } else {
                                val dx = x - startX
                                if (!done && abs(dx) > swipe && abs(dx) > abs(y - startY) * 1.5f) {
                                    done = true
                                    if ((dx < 0) != rightToLeft) latestOnUndo() else latestOnRedo()
                                    latestOnSwipe()
                                }
                            }
                            lastX = x
                            lastY = y
                            lastSpread = spread
                        }
                        // Once two fingers touched, the rest of the gesture is theirs, even when one lifts first.
                        if (twoFingers) event.changes.forEach { it.consume() }
                    }
                }
            }
            .pointerInput(tool) {
                detectTapGestures { offset ->
                    val f = latestFit ?: return@detectTapGestures
                    val p = f.toImage(offset.x, offset.y)
                    when (tool) {
                        // On an existing text, the Text tool edits it rather than adding another.
                        Tool.TEXT -> {
                            val existing = Select.textAt(latestEdits.now.shapes, p, reach / f.scale, renderer::textBox)
                            val shape = existing?.let { latestEdits.now.shapes[it] } as? Shape.Text
                            if (existing != null && shape != null) {
                                latestOnEditText(existing, shape.text)
                            } else {
                                latestOnText(p.inside(latestEdits.now.crop))
                            }
                        }
                        Tool.SELECT -> {
                            val current = latestSelected?.let { latestEdits.now.shapes.getOrNull(it) }
                            val onHandle = current?.let { Resize.gripAt(it, p, reach / f.scale, renderer::textBox) } != null
                            val hit = Select.at(latestEdits.now.shapes, p, reach / f.scale, renderer::textBox)
                            when {
                                onHandle -> Unit
                                // A second tap on a selected text edits it.
                                hit != null && hit == latestSelected && current is Shape.Text -> latestOnEditText(hit, current.text)
                                else -> latestOnSelect(hit)
                            }
                        }
                        else -> Unit
                    }
                }
            }
            .pointerInput(tool) {
                var start = Pt(0f, 0f)
                var handle: Handle? = null
                var startCrop = latestFull
                var grip: Grip? = null
                detectDragGestures(
                    onDragStart = { offset ->
                        val f = latestFit ?: return@detectDragGestures
                        val now = latestEdits.now
                        val p = f.toImage(offset.x, offset.y)
                        start = p
                        when (tool) {
                            Tool.CROP -> {
                                handle = Crop.handleAt(now.crop, p, reach / f.scale)
                                startCrop = now.crop
                            }
                            Tool.SELECT -> {
                                // A handle of the selected shape resizes it; anywhere else picks a shape to move.
                                val index = latestSelected?.takeIf { it in now.shapes.indices }
                                grip = index?.let { Resize.gripAt(now.shapes[it], p, reach / f.scale, renderer::textBox) }
                                if (index != null && grip != null) {
                                    moving = index to now.shapes[index]
                                } else {
                                    val hit = Select.at(now.shapes, p, reach / f.scale, renderer::textBox)
                                    latestOnSelect(hit)
                                    moving = hit?.let { it to now.shapes[it] }
                                }
                            }
                            Tool.TEXT -> Unit
                            else -> draft = shapeFor(tool, p.inside(now.crop), p.inside(now.crop), latestColor, latestStroke, sizes)
                        }
                    },
                    onDrag = { change, _ ->
                        val f = latestFit ?: return@detectDragGestures
                        change.consume()
                        val p = f.toImage(change.position.x, change.position.y)
                        if (tool == Tool.CROP) {
                            val h = handle ?: return@detectDragGestures
                            draftCrop = Crop.drag(startCrop, h, p.x - start.x, p.y - start.y, latestFull, sizes.unit * 24)
                        } else if (tool == Tool.SELECT) {
                            val (index, _) = moving ?: return@detectDragGestures
                            val original = latestEdits.now.shapes[index]
                            val dx = p.x - start.x
                            val dy = p.y - start.y
                            moving = index to (
                                grip?.let { Resize.drag(original, it, dx, dy, sizes.smallest, renderer::textBox) }
                                    ?: original.moved(dx, dy)
                                )
                        } else {
                            val inside = p.inside(latestEdits.now.crop)
                            draft = when (val d = draft) {
                                is Shape.Pen -> d.copy(points = d.points + inside)
                                null -> null
                                else -> shapeFor(tool, start.inside(latestEdits.now.crop), inside, latestColor, latestStroke, sizes)
                            }
                        }
                    },
                    onDragEnd = {
                        val now = latestEdits.now
                        draftCrop?.let { onEdit(latestEdits.then(now.copy(crop = it))) }
                        moving?.let { (index, shape) ->
                            onEdit(latestEdits.then(now.copy(shapes = now.shapes.mapIndexed { i, s -> if (i == index) shape else s })))
                        }
                        draft?.takeIf { it.isWorthKeeping(sizes) }?.let { onEdit(latestEdits.then(now.copy(shapes = now.shapes + it))) }
                        draft = null
                        draftCrop = null
                        moving = null
                        handle = null
                        grip = null
                    },
                    onDragCancel = {
                        draft = null
                        draftCrop = null
                        moving = null
                        handle = null
                        grip = null
                    },
                )
            },
    ) {
        val f = fit ?: return@Canvas
        // A blur being moved shows as a frame, as one being drawn: blurring on every move would be slow.
        val moved = moving
        val shapes = if (moved == null) {
            // While the tilt slider moves, blurs show as frames: blurring again on every step would be slow.
            if (preview != null) picture.shapes.filter { it !is Shape.Blur } else picture.shapes
        } else {
            picture.shapes.mapIndexedNotNull { i, s -> if (i == moved.first) moved.second.takeIf { it !is Shape.Blur } else s }
        }
        drawIntoCanvas { canvas ->
            val native = canvas.nativeCanvas
            native.withClip(f.toViewX(shown.left), f.toViewY(shown.top), f.toViewX(shown.right), f.toViewY(shown.bottom)) {
                translate(f.offsetX, f.offsetY)
                scale(f.scale, f.scale)
                translate(-shown.left, -shown.top)
                renderer.draw(this, shapes, picture)
                draft?.takeIf { it !is Shape.Blur }?.let { renderer.draw(this, it, picture) }
            }
        }
        // Blurring on every move would be slow: a dashed frame stands in while drawing, as on the desktop.
        (draft as? Shape.Blur)?.let { dashed(f, it.box) }
        if (preview != null) picture.shapes.filterIsInstance<Shape.Blur>().forEach { dashed(f, it.box) }
        if (tool == Tool.SELECT) {
            val shape = moved?.second ?: selected?.let { picture.shapes.getOrNull(it) }
            shape?.let { s ->
                // An arrow's two handles say enough: a frame around it would cover a large empty area.
                if (s !is Shape.Arrow) dashed(f, Select.bounds(s, renderer::textBox).grown(6.dp.toPx() / f.scale))
                Resize.grips(s, renderer::textBox).forEach { (_, at) ->
                    val centre = Offset(f.toViewX(at.x), f.toViewY(at.y))
                    drawCircle(Color.Black.copy(alpha = 0.6f), radius = 9.dp.toPx(), center = centre)
                    drawCircle(Color.White, radius = 7.dp.toPx(), center = centre)
                }
            }
        }
        if (tool == Tool.CROP) cropFrame(f, draftCrop ?: picture.crop)
    }
}

/** A dashed frame, dark under light so that it shows on any screenshot. */
private fun DrawScope.dashed(f: Fit, box: Box) {
    val topLeft = Offset(f.toViewX(box.left), f.toViewY(box.top))
    val size = Size(box.width * f.scale, box.height * f.scale)
    drawRect(Color.Black.copy(alpha = 0.6f), topLeft, size, style = DrawStroke(width = 4.dp.toPx()))
    drawRect(
        Color.White,
        topLeft,
        size,
        style = DrawStroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 8f))),
    )
}

/** Darkens what is cut off, and draws the frame with its thirds and corners. */
private fun DrawScope.cropFrame(f: Fit, crop: Box) {
    val left = f.toViewX(crop.left)
    val top = f.toViewY(crop.top)
    val right = f.toViewX(crop.right)
    val bottom = f.toViewY(crop.bottom)
    val imageLeft = f.toViewX(f.source.left)
    val imageTop = f.toViewY(f.source.top)
    val imageRight = f.toViewX(f.source.right)
    val imageBottom = f.toViewY(f.source.bottom)
    val shade = Color.Black.copy(alpha = 0.6f)
    drawRect(shade, Offset(imageLeft, imageTop), Size(imageRight - imageLeft, top - imageTop))
    drawRect(shade, Offset(imageLeft, bottom), Size(imageRight - imageLeft, imageBottom - bottom))
    drawRect(shade, Offset(imageLeft, top), Size(left - imageLeft, bottom - top))
    drawRect(shade, Offset(right, top), Size(imageRight - right, bottom - top))

    val thin = 1.dp.toPx()
    val faint = Color.White.copy(alpha = 0.5f)
    for (i in 1..2) {
        val x = left + (right - left) * i / 3
        val y = top + (bottom - top) * i / 3
        drawLine(faint, Offset(x, top), Offset(x, bottom), thin)
        drawLine(faint, Offset(left, y), Offset(right, y), thin)
    }
    drawRect(Color.White, Offset(left, top), Size(right - left, bottom - top), style = DrawStroke(2.dp.toPx()))

    val arm = 22.dp.toPx()
    val thick = 4.dp.toPx()
    listOf(
        Triple(left, top, Offset(1f, 1f)),
        Triple(right, top, Offset(-1f, 1f)),
        Triple(left, bottom, Offset(1f, -1f)),
        Triple(right, bottom, Offset(-1f, -1f)),
    ).forEach { (x, y, dir) ->
        drawLine(Color.White, Offset(x, y), Offset(x + dir.x * arm, y), thick)
        drawLine(Color.White, Offset(x, y), Offset(x, y + dir.y * arm), thick)
    }
}

private fun shapeFor(tool: Tool, a: Pt, b: Pt, color: Int, stroke: Stroke, sizes: Sizes): Shape? = when (tool) {
    Tool.PEN -> Shape.Pen(listOf(a), color, sizes.line(stroke))
    Tool.RECTANGLE -> Shape.Rectangle(Box.of(a, b), color, sizes.line(stroke))
    Tool.CIRCLE -> Shape.Circle(Box.of(a, b), color, sizes.line(stroke))
    Tool.ARROW -> Shape.Arrow(a, b, color, sizes.line(stroke))
    Tool.BLUR -> Shape.Blur(Box.of(a, b), sizes.blur(stroke))
    Tool.CROP, Tool.SELECT, Tool.TEXT -> null
}

/** A slip of the finger leaves nothing behind. */
internal fun Shape.isWorthKeeping(sizes: Sizes): Boolean = when (this) {
    is Shape.Pen -> points.size >= 2
    is Shape.Rectangle -> maxOf(box.width, box.height) >= sizes.smallest
    is Shape.Circle -> maxOf(box.width, box.height) >= sizes.smallest
    is Shape.Arrow -> hypot(to.x - from.x, to.y - from.y) >= sizes.smallest * 2
    is Shape.Blur -> box.width >= sizes.smallest && box.height >= sizes.smallest
    is Shape.Text -> text.isNotBlank()
}

internal fun Pt.inside(box: Box) = Pt(x.coerceIn(box.left, box.right), y.coerceIn(box.top, box.bottom))

@Composable
private fun Options(
    tool: Tool,
    colorIndex: Int,
    stroke: Stroke,
    canResetCrop: Boolean,
    onColor: (Int) -> Unit,
    onStroke: (Stroke) -> Unit,
    onRotateLeft: () -> Unit,
    onRotate: () -> Unit,
    onFlip: () -> Unit,
    onFlipVertical: () -> Unit,
    onResetCrop: () -> Unit,
    angle: Float,
    onTilt: (Float) -> Unit,
    onTiltDone: () -> Unit,
    onTiltReset: () -> Unit,
    selectedShape: Shape?,
    onRecolor: (Int) -> Unit,
    selectedStroke: Stroke?,
    onRestroke: (Stroke) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (tool == Tool.CROP) {
            // The hint on its own line: next to four buttons it would wrap word by word.
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.editor_crop_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onRotateLeft) {
                        Icon(painterResource(R.drawable.ic_rotate_left), contentDescription = stringResource(R.string.editor_rotate_left))
                    }
                    IconButton(onClick = onRotate) {
                        Icon(painterResource(R.drawable.ic_rotate), contentDescription = stringResource(R.string.editor_rotate))
                    }
                    IconButton(onClick = onFlip) {
                        Icon(painterResource(R.drawable.ic_flip), contentDescription = stringResource(R.string.editor_flip))
                    }
                    IconButton(onClick = onFlipVertical) {
                        Icon(painterResource(R.drawable.ic_flip_vertical), contentDescription = stringResource(R.string.editor_flip_vertical))
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onResetCrop, enabled = canResetCrop, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.editor_crop_reset))
                    }
                }
                TiltSlider(angle, onTilt, onTiltDone, onTiltReset)
            }
            return@Row
        }
        if (tool == Tool.SELECT) {
            // With a shape selected, its colours and thickness take the hint's place; a blur has no colour.
            val current = selectedShape?.color
            if (selectedShape == null || selectedStroke == null) {
                Text(
                    stringResource(R.string.editor_select_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Row(
                    Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    if (current != null) {
                        Row(Modifier.selectableGroup()) {
                            Palette.forEachIndexed { index, value ->
                                Swatch(Color(value), stringResource(ColorNames[index]), selected = value == current) { onRecolor(index) }
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                    }
                    StrokeButton(selectedStroke, onRestroke, text = selectedShape is Shape.Text)
                }
            }
            return@Row
        }
        Row(
            Modifier.weight(1f).horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            // The blur has no colour.
            if (tool != Tool.BLUR) {
                Row(Modifier.selectableGroup()) {
                    Palette.forEachIndexed { index, value ->
                        Swatch(Color(value), stringResource(ColorNames[index]), selected = index == colorIndex) { onColor(index) }
                    }
                }
                Spacer(Modifier.width(12.dp))
            }
            StrokeButton(stroke, onStroke, text = tool == Tool.TEXT)
        }
    }
}

private val ColorNames = listOf(
    R.string.editor_color_red,
    R.string.editor_color_orange,
    R.string.editor_color_green,
    R.string.editor_color_blue,
    R.string.editor_color_violet,
    R.string.editor_color_white,
)

private val StrokeNames = listOf(R.string.editor_stroke_thin, R.string.editor_stroke_medium, R.string.editor_stroke_thick)

private val TextSizeNames = listOf(R.string.editor_size_small, R.string.editor_size_medium, R.string.editor_size_large)

@Composable
private fun Swatch(color: Color, name: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .semantics { contentDescription = name },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(if (selected) 32.dp else 26.dp)
                .border(if (selected) 3.dp else 1.dp, if (selected) Color.White else Color.White.copy(alpha = 0.3f), CircleShape)
                .padding(if (selected) 5.dp else 0.dp)
                .background(color, CircleShape),
        )
    }
}

/** One button for the three thicknesses, each tap the next one: six colours and three dots won't fit a phone. */
@Composable
private fun StrokeButton(stroke: Stroke, onStroke: (Stroke) -> Unit, text: Boolean) {
    // For a text the same three steps are its size: an "A" says so better than a dot.
    val label = if (text) {
        stringResource(R.string.editor_text_size) + ": " + stringResource(TextSizeNames[stroke.ordinal])
    } else {
        stringResource(R.string.annotator_stroke) + ": " + stringResource(StrokeNames[stroke.ordinal])
    }
    Box(
        Modifier
            .size(44.dp)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(12.dp))
            .clickable(role = Role.Button) { onStroke(Stroke.entries[(stroke.ordinal + 1) % Stroke.entries.size]) }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        if (text) {
            Text(
                "A",
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Bold,
                fontSize = (13 + stroke.ordinal * 5).sp,
                modifier = Modifier.clearAndSetSemantics {},
            )
        } else {
            Box(Modifier.size((6 + stroke.ordinal * 6).dp).background(MaterialTheme.colorScheme.onSurface, CircleShape))
        }
    }
}

private data class ToolItem(val tool: Tool, @DrawableRes val icon: Int, @StringRes val name: Int)

private val ToolItems = listOf(
    ToolItem(Tool.CROP, R.drawable.ic_crop, R.string.editor_crop),
    ToolItem(Tool.SELECT, R.drawable.ic_select, R.string.annotator_tool_select),
    ToolItem(Tool.PEN, R.drawable.ic_pen, R.string.annotator_tool_pen),
    ToolItem(Tool.RECTANGLE, R.drawable.ic_square, R.string.annotator_tool_rectangle),
    ToolItem(Tool.CIRCLE, R.drawable.ic_circle, R.string.annotator_tool_circle),
    ToolItem(Tool.ARROW, R.drawable.ic_arrow, R.string.annotator_tool_arrow),
    ToolItem(Tool.TEXT, R.drawable.ic_text, R.string.annotator_tool_text),
    ToolItem(Tool.BLUR, R.drawable.ic_blur, R.string.annotator_tool_blur),
)

@Composable
private fun Tools(selected: Tool, onTool: (Tool) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(
                Modifier.fillMaxWidth().selectableGroup(),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                ToolItems.forEach { item ->
                    val on = item.tool == selected
                    Box(
                        Modifier
                            .size(44.dp)
                            .background(
                                if (on) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                                RoundedCornerShape(14.dp),
                            )
                            .selectable(selected = on, role = Role.RadioButton, onClick = { onTool(item.tool) }),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            painterResource(item.icon),
                            contentDescription = stringResource(item.name),
                            tint = if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            // The icons alone may not say enough: the chosen tool is named under them.
            Text(
                stringResource(ToolItems.first { it.tool == selected }.name),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/** A text to write: a new one where the finger was, or one already on the screenshot. */
private sealed interface Writing {
    data class New(val at: Pt) : Writing
    data class Existing(val index: Int, val text: String) : Writing
}

@Composable
private fun TextDialog(initial: String, editing: Boolean, onDismiss: () -> Unit, onDone: (String) -> Unit) {
    // The cursor starts at the end of a text being edited.
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(initial, TextRange(initial.length)))
    }
    val text = field.text
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val add = { if (text.isNotBlank()) onDone(text.trim()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (editing) R.string.editor_text_edit_title else R.string.editor_text_title)) },
        text = {
            OutlinedTextField(
                value = field,
                onValueChange = { field = it.copy(text = it.text.replace('\n', ' ')) },
                singleLine = true,
                label = { Text(stringResource(R.string.annotator_tool_text)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { add() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        },
        confirmButton = {
            TextButton(onClick = add, enabled = text.isNotBlank()) {
                Text(stringResource(if (editing) R.string.editor_text_save else R.string.editor_text_add))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.annotator_cancel)) }
        },
    )
}

/** Whether the two-finger tip was shown, kept on the phone. */
private object SwipeTip {
    private const val PREFS = "editor"
    private const val KEY = "swipe_tip_seen"

    fun seen(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun markSeen(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putBoolean(KEY, true) }
    }
}

@Composable
private fun SwipeTipBanner(modifier: Modifier, onDismiss: () -> Unit) {
    Surface(
        modifier = modifier.padding(12.dp).widthIn(max = 520.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        shadowElevation = 6.dp,
    ) {
        Row(
            Modifier
                .padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.editor_swipe_tip),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f).padding(vertical = 8.dp),
            )
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.editor_tip_ok))
            }
        }
    }
}

/** Free rotation: from 45 degrees one way to 45 the other, in half degrees, with 0 easy to find again. */
@Composable
private fun TiltSlider(angle: Float, onTilt: (Float) -> Unit, onDone: () -> Unit, onReset: () -> Unit) {
    val label = stringResource(R.string.editor_tilt)
    val shown = formatDegrees(angle)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            shown,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(56.dp).clearAndSetSemantics {},
        )
        Slider(
            value = angle,
            onValueChange = { value ->
                val half = (value * 2).roundToInt() / 2f
                onTilt(if (abs(half) < 1f) 0f else half)
            },
            onValueChangeFinished = onDone,
            valueRange = -Tilt.MAX..Tilt.MAX,
            modifier = Modifier
                .weight(1f)
                .semantics {
                    contentDescription = label
                    stateDescription = shown
                },
        )
        TextButton(onClick = onReset, enabled = angle != 0f, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.editor_tilt_reset))
        }
    }
}

/** Degrees as people write them: "12°", "-3.5°". */
private fun formatDegrees(angle: Float): String {
    val whole = angle.roundToInt().toFloat() == angle
    return (if (whole) angle.roundToInt().toString() else String.format(java.util.Locale.getDefault(), "%.1f", angle)) + "\u00B0"
}
