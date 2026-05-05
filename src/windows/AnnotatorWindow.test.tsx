import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AnnotatorWindow } from "./AnnotatorWindow";
import { useAnnotatorStore } from "@/store/annotatorStore";

// react-konva tries to use a real <canvas> backend, which jsdom doesn't
// provide. Mock it with light DOM stand-ins so we can test the surrounding
// chrome (toolbar, buttons, loading/error states) without pulling Konva in.
vi.mock("react-konva", () => ({
  Stage: ({ children, ...props }: { children?: React.ReactNode }) => (
    <div data-testid="annotator-stage" {...(props as object)}>
      {children}
    </div>
  ),
  Layer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Image: () => <div data-testid="kimage" />,
}));

vi.mock("@tauri-apps/api/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tauri-apps/api/core");
  return {
    ...actual,
    invoke: vi.fn(),
    convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
  };
});

function setLocation(search: string) {
  // jsdom forbids reassigning window.location, but we can mutate properties.
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, search },
  });
}

beforeEach(() => {
  useAnnotatorStore.getState().reset();
  setLocation("");
});

describe("<AnnotatorWindow />", () => {
  it("renders the toolbar shell", () => {
    setLocation("?window=annotator&path=" + encodeURIComponent("C:/tmp/cap.png"));
    render(<AnnotatorWindow />);
    expect(screen.getByTestId("annotator-toolbar")).toBeInTheDocument();
  });

  it("renders the loading state when no image has resolved yet", () => {
    setLocation("?window=annotator&path=" + encodeURIComponent("C:/tmp/cap.png"));
    render(<AnnotatorWindow />);
    expect(screen.getByText(/loading capture/i)).toBeInTheDocument();
  });

  it("renders the error state when the path query param is missing", () => {
    setLocation("?window=annotator");
    render(<AnnotatorWindow />);
    expect(screen.getByTestId("annotator-error")).toHaveTextContent(/missing path/i);
  });

  it("Cancel button hides the window and resets the canvas state", () => {
    const hide = vi.fn();
    vi.mocked(getCurrentWebviewWindow).mockReturnValue({
      show: vi.fn(),
      hide,
      setFocus: vi.fn(),
      close: vi.fn(),
    } as never);

    setLocation("?window=annotator&path=" + encodeURIComponent("C:/tmp/cap.png"));
    render(<AnnotatorWindow />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(hide).toHaveBeenCalled();
    expect(useAnnotatorStore.getState().shapes).toEqual([]);
  });

  it("Done button is disabled until the image has loaded", () => {
    setLocation("?window=annotator&path=" + encodeURIComponent("C:/tmp/cap.png"));
    render(<AnnotatorWindow />);
    expect(screen.getByRole("button", { name: /done/i })).toBeDisabled();
  });

  describe("keyboard shortcuts", () => {
    it.each([
      ["v", "select"],
      ["p", "pen"],
      ["r", "rectangle"],
      ["o", "circle"],
      ["a", "arrow"],
      ["t", "text"],
      ["b", "blur"],
    ])("`%s` switches to the %s tool", (key, expectedTool) => {
      setLocation("?window=annotator&path=" + encodeURIComponent("C:/tmp/cap.png"));
      render(<AnnotatorWindow />);
      fireEvent.keyDown(window, { key });
      expect(useAnnotatorStore.getState().tool).toBe(expectedTool);
    });

    it("Ctrl+Z calls undo, Ctrl+Y calls redo", () => {
      setLocation("?window=annotator&path=" + encodeURIComponent("C:/tmp/cap.png"));
      render(<AnnotatorWindow />);
      // seed history: add then add to give past + a possible redo
      const s = useAnnotatorStore.getState();
      s.addShape({
        id: "r1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        color: "#fff",
        strokeWidth: 2,
      });
      s.addShape({
        id: "r2",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        color: "#fff",
        strokeWidth: 2,
      });
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      expect(useAnnotatorStore.getState().shapes).toHaveLength(1);
      fireEvent.keyDown(window, { key: "y", ctrlKey: true });
      expect(useAnnotatorStore.getState().shapes).toHaveLength(2);
    });

    it("ignores letter shortcuts while a textarea has focus (so typing 'r' inserts an 'r')", () => {
      setLocation("?window=annotator&path=" + encodeURIComponent("C:/tmp/cap.png"));
      render(<AnnotatorWindow />);
      const ta = document.createElement("textarea");
      document.body.appendChild(ta);
      ta.focus();
      fireEvent.keyDown(ta, { key: "r" });
      expect(useAnnotatorStore.getState().tool).toBe("select"); // unchanged
      document.body.removeChild(ta);
    });
  });
});
