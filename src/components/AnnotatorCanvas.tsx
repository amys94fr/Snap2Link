import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import {
  Stage,
  Layer,
  Image as KImage,
  Rect as KRect,
  Ellipse as KEllipse,
  Arrow as KArrow,
  Line as KLine,
  Text as KText,
} from "react-konva";
import Konva from "konva";
import {
  useAnnotatorStore,
  type AnnotatorShape,
  type AnnotatorTool,
} from "@/store/annotatorStore";

interface DraftShape {
  tool: Exclude<AnnotatorTool, "select" | "text">;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  /** Pen freeform path accumulator. */
  points: number[];
}

/**
 * Renders a blurred region of the source image at (x,y) with the given
 * dimensions. Konva filters require the node to be cached before they
 * paint anything, which we do once per (x,y,w,h,radius) tuple in an
 * effect — Konva mutates the canvas so React's render cycle alone won't
 * trigger the filter.
 */
interface BlurPatchProps {
  sourceImage: HTMLImageElement;
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  blurRadius: number;
  selected?: boolean;
  draggable?: boolean;
  hitStrokeWidth?: number;
  onClick?: () => void;
  onTap?: () => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
}

function BlurPatch(props: BlurPatchProps) {
  const ref = useRef<Konva.Image | null>(null);
  const {
    sourceImage,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
    blurRadius,
    selected,
    ...rest
  } = props;
  const cropX = (x / sourceWidth) * sourceImage.naturalWidth;
  const cropY = (y / sourceHeight) * sourceImage.naturalHeight;
  const cropW = (width / sourceWidth) * sourceImage.naturalWidth;
  const cropH = (height / sourceHeight) * sourceImage.naturalHeight;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.cache();
    node.getLayer()?.batchDraw();
  }, [x, y, width, height, blurRadius, sourceImage]);

  return (
    <KImage
      ref={ref as never}
      image={sourceImage}
      x={x}
      y={y}
      width={width}
      height={height}
      crop={{ x: cropX, y: cropY, width: cropW, height: cropH }}
      filters={[Konva.Filters.Blur]}
      blurRadius={blurRadius}
      shadowColor={selected ? "#3b82f6" : undefined}
      shadowBlur={selected ? 8 : 0}
      {...rest}
    />
  );
}

interface Props {
  image: HTMLImageElement;
  width: number;
  height: number;
  /** A ref-like callback so parents can reach the underlying Konva Stage —
   *  needed to export the composite to PNG when the user hits "Done". */
  onStageReady?: (stage: Konva.Stage | null) => void;
  style?: CSSProperties;
}

const SHAPES_THAT_DRAW = new Set<AnnotatorTool>([
  "pen",
  "rectangle",
  "circle",
  "arrow",
  "blur",
]);

const MIN_SHAPE_PX = 4; // ignore tiny noise drags

function newId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/**
 * Renders the screenshot plus all shapes on top, and turns mouse drags
 * into shapes that get pushed into the annotator store. Only the simple
 * shapes (rectangle, circle, arrow) ship in step 3 — pen, text and blur
 * land in steps 4-6.
 */
export function AnnotatorCanvas({ image, width, height, onStageReady, style }: Props) {
  const tool = useAnnotatorStore((s) => s.tool);
  const color = useAnnotatorStore((s) => s.color);
  const strokeWidth = useAnnotatorStore((s) => s.strokeWidth);
  const shapes = useAnnotatorStore((s) => s.shapes);
  const addShape = useAnnotatorStore((s) => s.addShape);
  const updateShape = useAnnotatorStore((s) => s.updateShape);
  const deleteShape = useAnnotatorStore((s) => s.deleteShape);
  const selectedId = useAnnotatorStore((s) => s.selectedId);
  const setSelectedId = useAnnotatorStore((s) => s.setSelectedId);
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const isSelectMode = tool === "select";

  const stageRefCb = useCallback(
    (node: unknown) => {
      if (onStageReady) onStageReady((node as Konva.Stage | null) ?? null);
    },
    [onStageReady],
  );

  const startDrawing = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!SHAPES_THAT_DRAW.has(tool)) return;
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    setDraft({
      tool: tool as DraftShape["tool"],
      startX: pos.x,
      startY: pos.y,
      currentX: pos.x,
      currentY: pos.y,
      points: [pos.x, pos.y],
    });
  };

  const continueDrawing = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!draft) return;
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    setDraft({
      ...draft,
      currentX: pos.x,
      currentY: pos.y,
      points: [...draft.points, pos.x, pos.y],
    });
  };

  /**
   * Stroke width drives the text font size on the text tool — keeps the
   * "stroke" preset relevant across all tools instead of carrying a
   * separate font-size setting.
   */
  const fontSizeFromStroke = (w: number) => 12 + w * 4; // 2->20, 4->28, 8->44

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Select tool: clicking on empty canvas (the Stage itself, not a child
    // shape) deselects whatever was previously highlighted.
    if (isSelectMode) {
      const stage = e.target.getStage?.();
      if (e.target === stage) {
        setSelectedId(null);
      }
      return;
    }
    if (tool !== "text" || editingTextId) return;
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const id = newId();
    addShape({
      id,
      type: "text",
      x: pos.x,
      y: pos.y,
      text: "",
      color,
      fontSize: fontSizeFromStroke(strokeWidth),
    });
    setEditingTextId(id);
  };

  /**
   * Drag-end handler for an existing shape. Konva mutates the node's x/y
   * (or its origin offset for points-based shapes) during a drag — we
   * need to bake that delta back into the persistent shape data so the
   * next render starts from the new position.
   */
  const handleShapeDragEnd =
    (id: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
      const shape = shapes.find((s) => s.id === id);
      if (!shape) return;
      const dx = e.target.x();
      const dy = e.target.y();
      switch (shape.type) {
        case "rectangle":
        case "blur":
          updateShape(id, { x: dx, y: dy } as Partial<AnnotatorShape>);
          break;
        case "circle":
          updateShape(id, { x: dx, y: dy } as Partial<AnnotatorShape>);
          break;
        case "text":
          updateShape(id, { x: dx, y: dy } as Partial<AnnotatorShape>);
          break;
        case "arrow": {
          const [x1, y1, x2, y2] = shape.points;
          updateShape(id, {
            points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy] as [
              number,
              number,
              number,
              number,
            ],
          } as Partial<AnnotatorShape>);
          // Reset the Konva node origin so the next drag starts at (0,0).
          e.target.position({ x: 0, y: 0 });
          break;
        }
        case "pen": {
          const next = shape.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
          updateShape(id, { points: next } as Partial<AnnotatorShape>);
          e.target.position({ x: 0, y: 0 });
          break;
        }
      }
    };

  const handleShapeClick = (id: string) => () => {
    if (!isSelectMode) return;
    setSelectedId(id);
  };

  const editingText = shapes.find(
    (s): s is Extract<AnnotatorShape, { type: "text" }> =>
      s.id === editingTextId && s.type === "text",
  );

  const commitText = () => {
    if (!editingTextId || !editingText) {
      setEditingTextId(null);
      return;
    }
    if (editingText.text.trim() === "") {
      // empty text → drop the placeholder so we don't leave invisible nodes
      deleteShape(editingTextId);
    }
    setEditingTextId(null);
  };

  const finishDrawing = () => {
    if (!draft) return;
    const w = Math.abs(draft.currentX - draft.startX);
    const h = Math.abs(draft.currentY - draft.startY);
    const dx = draft.currentX - draft.startX;
    const dy = draft.currentY - draft.startY;

    let shape: AnnotatorShape | null = null;
    if (draft.tool === "rectangle" && w >= MIN_SHAPE_PX && h >= MIN_SHAPE_PX) {
      shape = {
        id: newId(),
        type: "rectangle",
        x: Math.min(draft.startX, draft.currentX),
        y: Math.min(draft.startY, draft.currentY),
        width: w,
        height: h,
        color,
        strokeWidth,
      };
    } else if (draft.tool === "circle" && w >= MIN_SHAPE_PX && h >= MIN_SHAPE_PX) {
      shape = {
        id: newId(),
        type: "circle",
        x: (draft.startX + draft.currentX) / 2,
        y: (draft.startY + draft.currentY) / 2,
        radiusX: w / 2,
        radiusY: h / 2,
        color,
        strokeWidth,
      };
    } else if (draft.tool === "arrow" && Math.hypot(dx, dy) >= MIN_SHAPE_PX) {
      shape = {
        id: newId(),
        type: "arrow",
        points: [draft.startX, draft.startY, draft.currentX, draft.currentY],
        color,
        strokeWidth,
      };
    } else if (draft.tool === "pen" && draft.points.length >= 4) {
      // Need at least two points to make a stroke worth keeping (4 numbers
      // because each point is x+y).
      shape = {
        id: newId(),
        type: "pen",
        points: draft.points,
        color,
        strokeWidth,
      };
    } else if (draft.tool === "blur" && w >= MIN_SHAPE_PX && h >= MIN_SHAPE_PX) {
      // strokeWidth doubles as the blur intensity preset (2 / 4 / 8).
      shape = {
        id: newId(),
        type: "blur",
        x: Math.min(draft.startX, draft.currentX),
        y: Math.min(draft.startY, draft.currentY),
        width: w,
        height: h,
        blurRadius: 4 + strokeWidth * 2, // 8 / 12 / 20
      };
    }
    if (shape) addShape(shape);
    setDraft(null);
  };

  const renderShape = (s: AnnotatorShape) => {
    const selected = s.id === selectedId && isSelectMode;
    /** Common props shared by every Konva shape so select-mode hit-testing,
     *  drag-and-drop, and click selection all flow through one path. */
    const commonProps = {
      draggable: isSelectMode,
      onClick: handleShapeClick(s.id),
      onTap: handleShapeClick(s.id),
      onDragEnd: handleShapeDragEnd(s.id),
      // Make a slightly thicker hit-test zone — thin lines are otherwise
      // hard to click.
      hitStrokeWidth: 16,
    };
    switch (s.type) {
      case "rectangle":
        return (
          <KRect
            key={s.id}
            {...commonProps}
            x={s.x}
            y={s.y}
            width={s.width}
            height={s.height}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            shadowColor={selected ? "#3b82f6" : undefined}
            shadowBlur={selected ? 8 : 0}
          />
        );
      case "circle":
        return (
          <KEllipse
            key={s.id}
            {...commonProps}
            x={s.x}
            y={s.y}
            radiusX={s.radiusX}
            radiusY={s.radiusY}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            shadowColor={selected ? "#3b82f6" : undefined}
            shadowBlur={selected ? 8 : 0}
          />
        );
      case "arrow":
        return (
          <KArrow
            key={s.id}
            {...commonProps}
            points={s.points as number[]}
            stroke={s.color}
            fill={s.color}
            strokeWidth={s.strokeWidth}
            pointerLength={10 + s.strokeWidth}
            pointerWidth={10 + s.strokeWidth}
            shadowColor={selected ? "#3b82f6" : undefined}
            shadowBlur={selected ? 8 : 0}
          />
        );
      case "pen":
        return (
          <KLine
            key={s.id}
            {...commonProps}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            tension={0.4}
            lineCap="round"
            lineJoin="round"
            shadowColor={selected ? "#3b82f6" : undefined}
            shadowBlur={selected ? 8 : 0}
          />
        );
      case "text":
        // While the user is editing, the textarea overlay shows the value;
        // we hide the Konva node so the two don't double-render.
        if (s.id === editingTextId) return null;
        return (
          <KText
            key={s.id}
            {...commonProps}
            x={s.x}
            y={s.y}
            text={s.text}
            fontSize={s.fontSize}
            fill={s.color}
            shadowColor={selected ? "#3b82f6" : undefined}
            shadowBlur={selected ? 8 : 0}
          />
        );
      case "blur":
        return (
          <BlurPatch
            key={s.id}
            {...commonProps}
            selected={selected}
            sourceImage={image}
            sourceWidth={width}
            sourceHeight={height}
            x={s.x}
            y={s.y}
            width={s.width}
            height={s.height}
            blurRadius={s.blurRadius}
          />
        );
      default:
        return null;
    }
  };

  const renderDraft = () => {
    if (!draft) return null;
    const w = Math.abs(draft.currentX - draft.startX);
    const h = Math.abs(draft.currentY - draft.startY);
    if (draft.tool === "rectangle") {
      return (
        <KRect
          x={Math.min(draft.startX, draft.currentX)}
          y={Math.min(draft.startY, draft.currentY)}
          width={w}
          height={h}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={[6, 6]}
        />
      );
    }
    if (draft.tool === "circle") {
      return (
        <KEllipse
          x={(draft.startX + draft.currentX) / 2}
          y={(draft.startY + draft.currentY) / 2}
          radiusX={w / 2}
          radiusY={h / 2}
          stroke={color}
          strokeWidth={strokeWidth}
          dash={[6, 6]}
        />
      );
    }
    if (draft.tool === "arrow") {
      return (
        <KArrow
          points={[draft.startX, draft.startY, draft.currentX, draft.currentY]}
          stroke={color}
          fill={color}
          strokeWidth={strokeWidth}
          pointerLength={10 + strokeWidth}
          pointerWidth={10 + strokeWidth}
        />
      );
    }
    if (draft.tool === "pen") {
      return (
        <KLine
          points={draft.points}
          stroke={color}
          strokeWidth={strokeWidth}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
        />
      );
    }
    if (draft.tool === "blur") {
      // Show a dashed marquee while drawing the blur region — applying the
      // real Konva blur filter on every mouse-move would tank perf.
      return (
        <KRect
          x={Math.min(draft.startX, draft.currentX)}
          y={Math.min(draft.startY, draft.currentY)}
          width={w}
          height={h}
          stroke="#9ca3af"
          strokeWidth={1}
          dash={[4, 4]}
          fill="rgba(148,163,184,0.25)"
        />
      );
    }
    return null;
  };

  return (
    <div
      style={{ position: "relative", width, height, ...style }}
      data-testid="annotator-canvas-wrapper"
    >
      <Stage
        ref={stageRefCb as never}
        width={width}
        height={height}
        onMouseDown={startDrawing}
        onMouseMove={continueDrawing}
        onMouseUp={finishDrawing}
        onMouseLeave={finishDrawing}
        onClick={handleStageClick}
        data-testid="annotator-stage"
      >
        <Layer listening={false}>
          <KImage image={image} width={width} height={height} />
        </Layer>
        <Layer>
          {shapes.map(renderShape)}
          {renderDraft()}
        </Layer>
      </Stage>
      {editingText && (
        <textarea
          autoFocus
          data-testid="annotator-text-input"
          value={editingText.text}
          onChange={(e) =>
            updateShape(editingText.id, { text: e.target.value } as Partial<AnnotatorShape>)
          }
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              commitText();
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText();
            }
          }}
          style={{
            position: "absolute",
            left: editingText.x,
            top: editingText.y,
            color: editingText.color,
            fontSize: editingText.fontSize,
            lineHeight: 1.1,
            background: "rgba(15,23,42,0.55)",
            padding: "2px 4px",
            border: `1px dashed ${editingText.color}`,
            outline: "none",
            resize: "none",
            minWidth: 80,
            minHeight: editingText.fontSize + 8,
            fontFamily: "inherit",
          }}
        />
      )}
    </div>
  );
}
