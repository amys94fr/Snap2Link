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

  it("hides the window when Escape is pressed in selecting mode", () => {
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

  it("after a >=10×10 drag, captures and shows the Edit / Save prompt", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      return undefined;
    });
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
    // The prompt is shown — Edit and Save buttons are now visible.
    expect(await screen.findByTestId("prompt-edit")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-save")).toBeInTheDocument();
    // Upload must NOT happen until the user picks Save.
    expect(invoke).not.toHaveBeenCalledWith("upload_screenshot", expect.anything());
  });

  it("clicking Save uploads, copies the link and notifies", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") return "https://drive/file/abc";
      return undefined;
    });

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 250 });

    const save = await screen.findByTestId("prompt-save");
    fireEvent.click(save);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("upload_screenshot", {
        imagePath: "C:/temp/cap.png",
      });
    });
    expect(writeText).toHaveBeenCalledWith("https://drive/file/abc");
    await waitFor(() => expect(sendNotification).toHaveBeenCalled());
  });

  it("clicking Edit hands off to the annotator (no upload from overlay)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      return undefined;
    });

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 250 });

    const edit = await screen.findByTestId("prompt-edit");
    fireEvent.click(edit);

    // Upload must NOT have happened — the annotator owns it from here.
    expect(invoke).not.toHaveBeenCalledWith("upload_screenshot", expect.anything());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("ESC from the prompt cancels the capture without uploading", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      return undefined;
    });
    const hide = vi.fn();
    vi.mocked(getCurrentWebviewWindow).mockReturnValue({
      hide,
      show: vi.fn(),
      setFocus: vi.fn(),
      close: vi.fn(),
    } as never);

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 250 });
    await screen.findByTestId("prompt-edit");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(invoke).not.toHaveBeenCalledWith("upload_screenshot", expect.anything());
    expect(hide).toHaveBeenCalled();
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

  it("shows the uploading→success toast when Save is picked", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") return "https://drive/x";
      return undefined;
    });

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 300 });
    fireEvent.click(await screen.findByTestId("prompt-save"));

    await waitFor(() => {
      expect(screen.getByText(/uploading to google drive/i)).toBeInTheDocument();
    });
    await waitFor(
      () => {
        expect(screen.getByText(/link copied/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("Save flow notifies on upload error", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") throw new Error("nope");
      return undefined;
    });

    render(<OverlayWindow />);
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 300 });
    fireEvent.click(await screen.findByTestId("prompt-save"));

    await waitFor(() => {
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining("nope") }),
      );
    });
    expect(screen.queryByText(/link copied/i)).not.toBeInTheDocument();
  });
});
