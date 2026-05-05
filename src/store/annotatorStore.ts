import { create } from "zustand";

/**
 * Drawing tools available in the annotator. `select` is the no-op pointer
 * used to pick existing shapes (move / resize / delete). The drawing tools
 * each create a new shape on mouse-up.
 */
export type AnnotatorTool =
  | "select"
  | "pen"
  | "rectangle"
  | "circle"
  | "arrow"
  | "text"
  | "blur";

/**
 * Stroke thickness presets — kept small so the toolbar stays compact.
 * Picked to roughly match the visual progression of the colour swatches.
 */
export type AnnotatorStrokeWidth = 2 | 4 | 8;

/**
 * Persisted shape on the canvas. Coordinates are in image-space (pixels of
 * the captured screenshot, NOT the rendered canvas) so we can re-render at
 * any zoom level without recomputing.
 */
export type AnnotatorShape =
  | {
      id: string;
      type: "pen";
      points: number[]; // flat [x1,y1,x2,y2,...] for Konva.Line
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: "rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: "circle";
      x: number;
      y: number;
      radiusX: number;
      radiusY: number;
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: "arrow";
      points: [number, number, number, number]; // [fromX, fromY, toX, toY]
      color: string;
      strokeWidth: number;
    }
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      text: string;
      color: string;
      fontSize: number;
    }
  | {
      id: string;
      type: "blur";
      x: number;
      y: number;
      width: number;
      height: number;
      blurRadius: number;
    };

export interface AnnotatorState {
  tool: AnnotatorTool;
  color: string;
  strokeWidth: AnnotatorStrokeWidth;
  shapes: AnnotatorShape[];
  /** History stack for undo. Each entry is a snapshot of `shapes` BEFORE
   *  the most recent mutation. Capped at 50 to bound memory. */
  past: AnnotatorShape[][];
  /** Re-do stack — populated when undo is called. Cleared on any new edit. */
  future: AnnotatorShape[][];
  selectedId: string | null;

  setTool: (tool: AnnotatorTool) => void;
  setColor: (color: string) => void;
  setStrokeWidth: (width: AnnotatorStrokeWidth) => void;

  addShape: (shape: AnnotatorShape) => void;
  updateShape: (id: string, patch: Partial<AnnotatorShape>) => void;
  deleteShape: (id: string) => void;
  setSelectedId: (id: string | null) => void;

  undo: () => void;
  redo: () => void;
  reset: () => void;
}

/** Default colour palette — matches the toolbar swatches. */
export const DEFAULT_COLORS = [
  "#EF4444", // red
  "#F59E0B", // orange
  "#22C55E", // green
  "#3B82F6", // blue
  "#A855F7", // violet
  "#FFFFFF", // white
] as const;

const HISTORY_LIMIT = 50;

function pushHistory(
  past: AnnotatorShape[][],
  current: AnnotatorShape[],
): AnnotatorShape[][] {
  const next = [...past, current];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export const useAnnotatorStore = create<AnnotatorState>((set, get) => ({
  tool: "select",
  color: DEFAULT_COLORS[0],
  strokeWidth: 4,
  shapes: [],
  past: [],
  future: [],
  selectedId: null,

  setTool: (tool) => set({ tool, selectedId: tool === "select" ? get().selectedId : null }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),

  addShape: (shape) => {
    const { shapes, past } = get();
    set({
      shapes: [...shapes, shape],
      past: pushHistory(past, shapes),
      future: [],
    });
  },

  updateShape: (id, patch) => {
    const { shapes, past } = get();
    const idx = shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const existing = shapes[idx] as AnnotatorShape;
    const updated = { ...existing, ...patch } as AnnotatorShape;
    const nextShapes = [...shapes];
    nextShapes[idx] = updated;
    set({
      shapes: nextShapes,
      past: pushHistory(past, shapes),
      future: [],
    });
  },

  deleteShape: (id) => {
    const { shapes, past, selectedId } = get();
    set({
      shapes: shapes.filter((s) => s.id !== id),
      past: pushHistory(past, shapes),
      future: [],
      selectedId: selectedId === id ? null : selectedId,
    });
  },

  setSelectedId: (selectedId) => set({ selectedId }),

  undo: () => {
    const { past, shapes, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      shapes: previous,
      past: past.slice(0, -1),
      future: [shapes, ...future],
      selectedId: null,
    });
  },

  redo: () => {
    const { past, shapes, future } = get();
    if (future.length === 0) return;
    const [next, ...rest] = future;
    set({
      shapes: next,
      past: [...past, shapes],
      future: rest,
      selectedId: null,
    });
  },

  reset: () =>
    set({
      tool: "select",
      color: DEFAULT_COLORS[0],
      strokeWidth: 4,
      shapes: [],
      past: [],
      future: [],
      selectedId: null,
    }),
}));
