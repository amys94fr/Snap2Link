import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { OverlayWindow } from "./OverlayWindow";

describe("<OverlayWindow />", () => {
  it("renders the hint message", () => {
    render(<OverlayWindow />);
    expect(screen.getByText(/select an area/i)).toBeInTheDocument();
  });

  it("hides the window when Escape is pressed", () => {
    const hide = vi.fn();
    vi.mocked(getCurrentWebviewWindow).mockReturnValue({
      hide,
      show: vi.fn(),
      setFocus: vi.fn(),
      close: vi.fn(),
    } as never);

    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(hide).toHaveBeenCalled();
  });

  it("captures and uploads on mouse drag of >= 10×10 px when annotator is OFF", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "get_config") return { enable_annotator: false };
      if (cmd === "upload_screenshot") return "https://drive/file/abc";
      return undefined;
    });
    vi.mocked(getCurrentWebviewWindow).mockReturnValue({
      hide: vi.fn(),
      show: vi.fn(),
      setFocus: vi.fn(),
      close: vi.fn(),
    } as never);

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 250 });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("capture_region", {
        x: 100,
        y: 100,
        width: 200,
        height: 150,
      });
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("upload_screenshot", {
        imagePath: "C:/temp/cap.png",
      });
    });
    expect(writeText).toHaveBeenCalledWith("https://drive/file/abc");
    expect(sendNotification).toHaveBeenCalled();
  });

  it("hands the capture off to the annotator window when the annotator is ON", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "get_config") return { enable_annotator: true };
      return undefined;
    });

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 250 });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("capture_region", expect.anything());
    });
    // Upload must NOT happen from the overlay — the annotator owns it now.
    expect(invoke).not.toHaveBeenCalledWith("upload_screenshot", expect.anything());
    // And the clipboard must not be touched here either.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does nothing when the selection is smaller than 10x10", () => {
    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 102, clientY: 102 });
    fireEvent.mouseUp(surface, { clientX: 102, clientY: 102 });

    expect(invoke).not.toHaveBeenCalledWith("capture_region", expect.anything());
  });

  it("normalizes the rectangle when dragging up-left", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "get_config") return { enable_annotator: false };
      if (cmd === "upload_screenshot") return "https://drive/x";
      return undefined;
    });
    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(surface, { clientX: 100, clientY: 100 });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("capture_region", {
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      });
    });
  });

  it("shows the in-overlay toast (uploading then success) during a capture", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "get_config") return { enable_annotator: false };
      if (cmd === "upload_screenshot") return "https://drive/x";
      return undefined;
    });

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 300 });

    // The "uploading" state appears first while the upload is in flight.
    await waitFor(() => {
      expect(screen.getByText(/uploading to google drive/i)).toBeInTheDocument();
    });
    // Then the success state takes over once the clipboard has been written.
    await waitFor(
      () => {
        expect(screen.getByText(/link copied/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("hides the toast even when the upload fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "get_config") return { enable_annotator: false };
      if (cmd === "upload_screenshot") throw new Error("nope");
      return undefined;
    });

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 300 });

    // The error notification must be sent.
    await waitFor(() => {
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("nope") }),
      );
    });
    // And the toast must not stay stuck on success.
    expect(screen.queryByText(/link copied/i)).not.toBeInTheDocument();
  });
});
