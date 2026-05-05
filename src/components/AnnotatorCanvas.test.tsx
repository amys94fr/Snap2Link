import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { AnnotatorCanvas } from "./AnnotatorCanvas";
import { useAnnotatorStore } from "@/store/annotatorStore";

/**
 * react-konva is hard to run under jsdom (Konva pulls real <canvas>). We
 * stub the Stage as a plain div whose mouse-event handlers translate
 * `clientX/clientY` into the Konva-shaped callbacks the canvas component
 * expects (`e.target.getStage().getPointerPosition()`). Each shape
 * component renders a div tagged with its props so tests can assert what
 * the canvas tried to draw.
 */
vi.mock("react-konva", () => {
  const fakeStage = (e: { clientX?: number; clientY?: number }) => ({
    target: {
      getStage: () => ({
        getPointerPosition: () =>
          e.clientX === undefined || e.clientY === undefined
            ? null
            : { x: e.clientX, y: e.clientY },
      }),
    },
  });
  type Handler = (
    e: { target: { getStage: () => unknown } },
  ) => void;
  return {
    Stage: ({
      children,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      onClick,
      width,
      height,
    }: {
      children?: React.ReactNode;
      onMouseDown?: Handler;
      onMouseMove?: Handler;
      onMouseUp?: Handler;
      onMouseLeave?: Handler;
      onClick?: Handler;
      width?: number;
      height?: number;
    }) => (
      <div
        data-testid="annotator-stage"
        data-width={width}
        data-height={height}
        onMouseDown={(e) => onMouseDown?.(fakeStage(e))}
        onMouseMove={(e) => onMouseMove?.(fakeStage(e))}
        onMouseUp={(e) => onMouseUp?.(fakeStage(e))}
        onMouseLeave={(e) => onMouseLeave?.(fakeStage(e))}
        onClick={(e) => onClick?.(fakeStage(e))}
      >
        {children}
      </div>
    ),
    Layer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Image: () => <div data-testid="kimage" />,
    Rect: (props: Record<string, unknown>) => (
      <div
        data-testid="krect"
        data-props={JSON.stringify(props)}
        onClick={props.onClick as React.MouseEventHandler}
      />
    ),
    Ellipse: (props: Record<string, unknown>) => (
      <div
        data-testid="kellipse"
        data-props={JSON.stringify(props)}
        onClick={props.onClick as React.MouseEventHandler}
      />
    ),
    Arrow: (props: Record<string, unknown>) => (
      <div
        data-testid="karrow"
        data-props={JSON.stringify(props)}
        onClick={props.onClick as React.MouseEventHandler}
      />
    ),
    Line: (props: Record<string, unknown>) => (
      <div
        data-testid="kline"
        data-props={JSON.stringify(props)}
        onClick={props.onClick as React.MouseEventHandler}
      />
    ),
    Text: (props: Record<string, unknown>) => (
      <div
        data-testid="ktext"
        data-props={JSON.stringify(props)}
        onClick={props.onClick as React.MouseEventHandler}
      />
    ),
  };
});

const fakeImage = {} as HTMLImageElement;

beforeEach(() => {
  useAnnotatorStore.getState().reset();
});

function drag(start: [number, number], end: [number, number]) {
  const stage = screen.getByTestId("annotator-stage");
  fireEvent.mouseDown(stage, { clientX: start[0], clientY: start[1] });
  fireEvent.mouseMove(stage, { clientX: end[0], clientY: end[1] });
  fireEvent.mouseUp(stage, { clientX: end[0], clientY: end[1] });
}

describe("<AnnotatorCanvas /> — drawing", () => {
  it("does nothing when the active tool is 'select'", () => {
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    drag([10, 10], [100, 100]);
    expect(useAnnotatorStore.getState().shapes).toEqual([]);
  });

  it("rectangle tool: drag adds a rectangle shape with normalised coords", () => {
    useAnnotatorStore.getState().setTool("rectangle");
    useAnnotatorStore.getState().setColor("#ff0000");
    useAnnotatorStore.getState().setStrokeWidth(8);
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    // drag bottom-right then up-left to verify normalisation
    drag([200, 200], [50, 80]);
    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      type: "rectangle",
      x: 50,
      y: 80,
      width: 150,
      height: 120,
      color: "#ff0000",
      strokeWidth: 8,
    });
  });

  it("circle tool: drag adds an ellipse centred between start and end", () => {
    useAnnotatorStore.getState().setTool("circle");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    drag([20, 30], [120, 130]);
    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      type: "circle",
      x: 70,
      y: 80,
      radiusX: 50,
      radiusY: 50,
    });
  });

  it("arrow tool: drag adds an arrow from start to end", () => {
    useAnnotatorStore.getState().setTool("arrow");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    drag([10, 10], [100, 200]);
    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      type: "arrow",
      points: [10, 10, 100, 200],
    });
  });

  it("ignores drags shorter than 4 px", () => {
    useAnnotatorStore.getState().setTool("rectangle");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    drag([10, 10], [12, 12]);
    expect(useAnnotatorStore.getState().shapes).toEqual([]);
  });

  it("text tool: click places an editable text shape", () => {
    useAnnotatorStore.getState().setTool("text");
    useAnnotatorStore.getState().setColor("#3b82f6");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);

    fireEvent.click(screen.getByTestId("annotator-stage"), {
      clientX: 80,
      clientY: 120,
    });

    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      type: "text",
      x: 80,
      y: 120,
      text: "",
      color: "#3b82f6",
    });
    // The textarea overlay opens immediately so the user can start typing.
    expect(screen.getByTestId("annotator-text-input")).toBeInTheDocument();
  });

  it("text tool: typing then blurring commits the text", () => {
    useAnnotatorStore.getState().setTool("text");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    fireEvent.click(screen.getByTestId("annotator-stage"), { clientX: 10, clientY: 10 });
    const ta = screen.getByTestId("annotator-text-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "Hello" } });
    fireEvent.blur(ta);
    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect((shapes[0] as { text: string }).text).toBe("Hello");
    expect(screen.queryByTestId("annotator-text-input")).not.toBeInTheDocument();
  });

  it("text tool: empty text on commit drops the placeholder shape", () => {
    useAnnotatorStore.getState().setTool("text");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    fireEvent.click(screen.getByTestId("annotator-stage"), { clientX: 10, clientY: 10 });
    expect(useAnnotatorStore.getState().shapes).toHaveLength(1);
    fireEvent.blur(screen.getByTestId("annotator-text-input"));
    expect(useAnnotatorStore.getState().shapes).toHaveLength(0);
  });

  it("text tool: Escape commits with whatever's been typed", () => {
    useAnnotatorStore.getState().setTool("text");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    fireEvent.click(screen.getByTestId("annotator-stage"), { clientX: 10, clientY: 10 });
    const ta = screen.getByTestId("annotator-text-input");
    fireEvent.change(ta, { target: { value: "x" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect((shapes[0] as { text: string }).text).toBe("x");
  });

  it("pen tool: drag accumulates a polyline of points", () => {
    useAnnotatorStore.getState().setTool("pen");
    useAnnotatorStore.getState().setColor("#22c55e");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    const stage = screen.getByTestId("annotator-stage");
    fireEvent.mouseDown(stage, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(stage, { clientX: 20, clientY: 30 });
    fireEvent.mouseMove(stage, { clientX: 40, clientY: 60 });
    fireEvent.mouseUp(stage, { clientX: 40, clientY: 60 });
    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0].type).toBe("pen");
    // Start point + 2 mouse moves + final mouse-up coord = 4 points (8 numbers)
    expect((shapes[0] as { points: number[] }).points.length).toBeGreaterThanOrEqual(6);
    expect((shapes[0] as { color: string }).color).toBe("#22c55e");
  });

  it("blur tool: drag adds a blur shape with a radius derived from stroke width", () => {
    useAnnotatorStore.getState().setTool("blur");
    useAnnotatorStore.getState().setStrokeWidth(8);
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    drag([20, 20], [120, 80]);
    const shapes = useAnnotatorStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      type: "blur",
      x: 20,
      y: 20,
      width: 100,
      height: 60,
      blurRadius: 20, // 4 + 8 * 2
    });
  });

  it("select tool: clicking a shape sets it as the selected shape", () => {
    useAnnotatorStore.getState().addShape({
      id: "r1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      color: "#fff",
      strokeWidth: 2,
    });
    useAnnotatorStore.getState().setTool("select");
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    fireEvent.click(screen.getByTestId("krect"));
    expect(useAnnotatorStore.getState().selectedId).toBe("r1");
  });

  it("select tool: shapes are draggable; non-select tools leave them static", () => {
    useAnnotatorStore.getState().addShape({
      id: "r1",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      color: "#fff",
      strokeWidth: 2,
    });
    // pen tool by default — no drag
    useAnnotatorStore.getState().setTool("pen");
    const { rerender } = render(
      <AnnotatorCanvas image={fakeImage} width={400} height={300} />,
    );
    let props = JSON.parse(
      screen.getByTestId("krect").getAttribute("data-props") ?? "{}",
    );
    expect(props.draggable).toBe(false);

    // switch to select — now the shape is draggable
    useAnnotatorStore.getState().setTool("select");
    rerender(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    props = JSON.parse(
      screen.getByTestId("krect").getAttribute("data-props") ?? "{}",
    );
    expect(props.draggable).toBe(true);
  });

  it("renders existing shapes from the store", () => {
    useAnnotatorStore.getState().addShape({
      id: "r1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      color: "#fff",
      strokeWidth: 2,
    });
    useAnnotatorStore.getState().addShape({
      id: "a1",
      type: "arrow",
      points: [0, 0, 10, 10],
      color: "#fff",
      strokeWidth: 2,
    });
    render(<AnnotatorCanvas image={fakeImage} width={400} height={300} />);
    expect(screen.getByTestId("krect")).toBeInTheDocument();
    expect(screen.getByTestId("karrow")).toBeInTheDocument();
  });
});
