import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnnotatorToolbar } from "./AnnotatorToolbar";
import { useAnnotatorStore, DEFAULT_COLORS } from "@/store/annotatorStore";

beforeEach(() => {
  useAnnotatorStore.getState().reset();
});

describe("<AnnotatorToolbar />", () => {
  it("renders all 7 tool buttons", () => {
    render(<AnnotatorToolbar />);
    for (const id of ["select", "pen", "rectangle", "circle", "arrow", "text", "blur"]) {
      expect(screen.getByTestId(`tool-${id}`)).toBeInTheDocument();
    }
  });

  it("highlights the active tool and switches when clicked", () => {
    render(<AnnotatorToolbar />);
    expect(screen.getByTestId("tool-select")).toHaveAttribute("data-active", "true");

    fireEvent.click(screen.getByTestId("tool-rectangle"));
    expect(useAnnotatorStore.getState().tool).toBe("rectangle");
    expect(screen.getByTestId("tool-rectangle")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("tool-select")).toHaveAttribute("data-active", "false");
  });

  it("renders all 6 default colour swatches and applies one on click", () => {
    render(<AnnotatorToolbar />);
    for (const c of DEFAULT_COLORS) {
      expect(screen.getByTestId(`color-${c.toLowerCase()}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("color-#22c55e"));
    expect(useAnnotatorStore.getState().color).toBe("#22C55E");
  });

  it("custom colour picker writes through to the store", () => {
    render(<AnnotatorToolbar />);
    const input = screen.getByTestId("annotator-color-custom") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#abcdef" } });
    expect(useAnnotatorStore.getState().color).toBe("#abcdef");
  });

  it("renders all 3 stroke widths and applies them on click", () => {
    render(<AnnotatorToolbar />);
    for (const w of [2, 4, 8]) {
      expect(screen.getByTestId(`stroke-${w}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("stroke-4")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByTestId("stroke-8"));
    expect(useAnnotatorStore.getState().strokeWidth).toBe(8);
    expect(screen.getByTestId("stroke-8")).toHaveAttribute("data-active", "true");
  });
});
