import { describe, expect, it, beforeEach } from "vitest";
import {
  useAnnotatorStore,
  DEFAULT_COLORS,
  type AnnotatorShape,
} from "./annotatorStore";

const rect = (id: string): AnnotatorShape => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  color: "#fff",
  strokeWidth: 2,
});

beforeEach(() => {
  useAnnotatorStore.getState().reset();
});

describe("annotatorStore — tool + colour state", () => {
  it("starts with sane defaults", () => {
    const s = useAnnotatorStore.getState();
    expect(s.tool).toBe("select");
    expect(s.color).toBe(DEFAULT_COLORS[0]);
    expect(s.strokeWidth).toBe(4);
    expect(s.shapes).toEqual([]);
    expect(s.selectedId).toBeNull();
  });

  it("setTool updates the active tool", () => {
    useAnnotatorStore.getState().setTool("rectangle");
    expect(useAnnotatorStore.getState().tool).toBe("rectangle");
  });

  it("switching to a non-select tool clears the selection", () => {
    useAnnotatorStore.setState({ selectedId: "abc" });
    useAnnotatorStore.getState().setTool("arrow");
    expect(useAnnotatorStore.getState().selectedId).toBeNull();
  });

  it("setColor + setStrokeWidth flow through", () => {
    useAnnotatorStore.getState().setColor("#123456");
    useAnnotatorStore.getState().setStrokeWidth(8);
    const s = useAnnotatorStore.getState();
    expect(s.color).toBe("#123456");
    expect(s.strokeWidth).toBe(8);
  });
});

describe("annotatorStore — shape CRUD", () => {
  it("addShape appends and snapshots history", () => {
    useAnnotatorStore.getState().addShape(rect("a"));
    useAnnotatorStore.getState().addShape(rect("b"));
    const s = useAnnotatorStore.getState();
    expect(s.shapes.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.past.length).toBe(2);
    expect(s.future).toEqual([]);
  });

  it("updateShape patches the matching shape only", () => {
    useAnnotatorStore.getState().addShape(rect("a"));
    useAnnotatorStore.getState().addShape(rect("b"));
    useAnnotatorStore.getState().updateShape("b", { width: 999 });
    const s = useAnnotatorStore.getState();
    expect((s.shapes[0] as { width: number }).width).toBe(10);
    expect((s.shapes[1] as { width: number }).width).toBe(999);
  });

  it("deleteShape removes by id and clears selection if it was selected", () => {
    useAnnotatorStore.getState().addShape(rect("a"));
    useAnnotatorStore.getState().addShape(rect("b"));
    useAnnotatorStore.getState().setSelectedId("b");
    useAnnotatorStore.getState().deleteShape("b");
    const s = useAnnotatorStore.getState();
    expect(s.shapes.map((x) => x.id)).toEqual(["a"]);
    expect(s.selectedId).toBeNull();
  });
});

describe("annotatorStore — undo / redo", () => {
  it("undo restores the previous shape list", () => {
    useAnnotatorStore.getState().addShape(rect("a"));
    useAnnotatorStore.getState().addShape(rect("b"));
    useAnnotatorStore.getState().undo();
    expect(useAnnotatorStore.getState().shapes.map((s) => s.id)).toEqual(["a"]);
  });

  it("redo reapplies an undone change", () => {
    useAnnotatorStore.getState().addShape(rect("a"));
    useAnnotatorStore.getState().addShape(rect("b"));
    useAnnotatorStore.getState().undo();
    useAnnotatorStore.getState().redo();
    expect(useAnnotatorStore.getState().shapes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("a new edit after undo wipes the redo stack", () => {
    useAnnotatorStore.getState().addShape(rect("a"));
    useAnnotatorStore.getState().addShape(rect("b"));
    useAnnotatorStore.getState().undo();
    useAnnotatorStore.getState().addShape(rect("c"));
    expect(useAnnotatorStore.getState().future).toEqual([]);
  });

  it("undo is a no-op when there's nothing to undo", () => {
    useAnnotatorStore.getState().undo();
    expect(useAnnotatorStore.getState().shapes).toEqual([]);
    expect(useAnnotatorStore.getState().past).toEqual([]);
  });

  it("history is bounded — adding 60 shapes keeps at most 50 entries in past", () => {
    for (let i = 0; i < 60; i++) {
      useAnnotatorStore.getState().addShape(rect(`s${i}`));
    }
    expect(useAnnotatorStore.getState().past.length).toBe(50);
  });
});

describe("annotatorStore — reset", () => {
  it("returns the store to its initial state", () => {
    useAnnotatorStore.getState().addShape(rect("a"));
    useAnnotatorStore.getState().setTool("arrow");
    useAnnotatorStore.getState().setColor("#000000");
    useAnnotatorStore.getState().reset();
    const s = useAnnotatorStore.getState();
    expect(s.shapes).toEqual([]);
    expect(s.tool).toBe("select");
    expect(s.color).toBe(DEFAULT_COLORS[0]);
    expect(s.past).toEqual([]);
  });
});
