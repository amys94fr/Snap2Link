import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { OverlayWindow } from "./OverlayWindow";

type Handler = (e: { payload: unknown }) => void;

/** Renders the overlay and returns a function that fires a capture request,
 *  as Rust does when a shortcut is pressed. */
async function renderWithTrigger() {
  const handlers: Record<string, Handler> = {};
  vi.mocked(listen).mockImplementation((async (name: string, cb: Handler) => {
    handlers[name] = cb;
    return () => {};
  }) as never);
  render(<OverlayWindow />);
  await waitFor(() => expect(handlers["trigger-screenshot"]).toBeDefined());
  return async (request: Record<string, unknown>) => {
    await act(async () => {
      handlers["trigger-screenshot"]({
        payload: { last_mode: null, last_after: null, ...request },
      });
    });
  };
}

function dragRegion() {
  const surface = screen.getByTestId("overlay-surface");
  fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
  fireEvent.mouseMove(surface, { clientX: 300, clientY: 250 });
  fireEvent.mouseUp(surface, { clientX: 300, clientY: 250 });
}

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
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://drive/file/abc");
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("show_toast", { state: "copied" });
    });
  });

  it("falls back on a notification if the toast window fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") return "https://drive/x";
      if (cmd === "show_toast") throw new Error("no toast");
      return undefined;
    });
    render(<OverlayWindow />);
    dragRegion();
    fireEvent.click(await screen.findByTestId("prompt-save"));

    await waitFor(() => {
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringMatching(/link copied/i) }),
      );
    });
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

  it("reports the upload in the toast window, with the overlay gone", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") return "https://drive/x";
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
    dragRegion();
    fireEvent.click(await screen.findByTestId("prompt-save"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("show_toast", { state: "uploading" });
    });
    expect(hide).toHaveBeenCalled();
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
    expect(invoke).not.toHaveBeenCalledWith("show_toast", { state: "copied" });
    expect(invoke).toHaveBeenCalledWith("hide_toast");
  });

  // ────────────────────────────────────────────────────────────────────
  // Shortcuts set in advance
  // ────────────────────────────────────────────────────────────────────

  it("full screen + share: link copied without ever opening the overlay", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_at_cursor") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") return "https://drive/x";
      return undefined;
    });
    const show = vi.fn();
    vi.mocked(getCurrentWebviewWindow).mockReturnValue({
      hide: vi.fn(),
      show,
      setFocus: vi.fn(),
      close: vi.fn(),
    } as never);

    const trigger = await renderWithTrigger();
    await trigger({ mode: "full_screen", after: "share" });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://drive/x"));
    expect(show).not.toHaveBeenCalled();
    expect(screen.queryByTestId("overlay-prompt")).not.toBeInTheDocument();
  });

  it("waits for a visible toast to leave before a direct capture", async () => {
    const order: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      order.push(cmd);
      if (cmd === "hide_toast") return true;
      if (cmd === "capture_at_cursor") return "C:/temp/cap.png";
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "full_screen", after: "ask" });

    await screen.findByTestId("prompt-edit");
    expect(order.indexOf("hide_toast")).toBeLessThan(
      order.indexOf("capture_at_cursor"),
    );
  });

  it("active window + ask: captures it and shows the prompt", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_active_window") return "C:/temp/cap.png";
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "active_window", after: "ask" });

    expect(await screen.findByTestId("prompt-edit")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("upload_screenshot", expect.anything());
  });

  it("falls back on the window picker when nothing is in front", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_active_window") throw "no_active_window";
      if (cmd === "list_windows") return [];
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "active_window", after: "share" });

    expect(await screen.findByTestId("overlay-window-picker")).toBeInTheDocument();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("region + annotate: goes to the annotator, no prompt", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "region", after: "annotate" });
    dragRegion();

    await waitFor(() => {
      expect(emit).toHaveBeenCalledWith("annotator-load", {
        path: "C:/temp/cap.png",
      });
    });
    expect(screen.queryByTestId("overlay-prompt")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("upload_screenshot", expect.anything());
  });

  // ────────────────────────────────────────────────────────────────────
  // Last choice
  // ────────────────────────────────────────────────────────────────────

  it("reopens on the last mode when the shortcut is on Ask", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_windows") return [];
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "ask", after: "ask", last_mode: "fullScreen" });

    expect(await screen.findByTestId("mode-tab-fullScreen")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("a mode set on the shortcut wins over the last choice", async () => {
    const trigger = await renderWithTrigger();
    await trigger({ mode: "region", after: "ask", last_mode: "window" });

    expect(await screen.findByTestId("mode-tab-region")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("preselects the last action but only Enter confirms it", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") return "https://drive/x";
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "region", after: "ask", last_after: "save" });
    dragRegion();

    const save = await screen.findByTestId("prompt-save");
    expect(save).toHaveAttribute("data-preferred", "true");
    expect(invoke).not.toHaveBeenCalledWith("upload_screenshot", expect.anything());

    fireEvent.keyDown(document, { key: "Enter" });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("upload_screenshot", {
        imagePath: "C:/temp/cap.png",
      });
    });
  });

  it("remembers only the steps left on Ask, after the capture went through", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") return "https://drive/x";
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "region", after: "ask" });
    dragRegion();
    fireEvent.click(await screen.findByTestId("prompt-save"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_last_choice", {
        mode: null,
        after: "save",
      });
    });
  });

  it("remembers nothing when the upload fails or the prompt is cancelled", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_region") return "C:/temp/cap.png";
      if (cmd === "upload_screenshot") throw new Error("nope");
      return undefined;
    });
    const trigger = await renderWithTrigger();
    await trigger({ mode: "ask", after: "ask" });
    dragRegion();
    fireEvent.click(await screen.findByTestId("prompt-save"));

    await waitFor(() => expect(sendNotification).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalledWith(
      "save_last_choice",
      expect.anything(),
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // Capture mode tabs
  // ────────────────────────────────────────────────────────────────────

  it("renders the mode toolbar with Region active by default", () => {
    render(<OverlayWindow />);
    const region = screen.getByTestId("mode-tab-region");
    expect(region).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mode-tab-fullScreen")).toHaveAttribute(
      "data-active",
      "false",
    );
    expect(screen.getByTestId("mode-tab-window")).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("pressing F switches to Full Screen mode and shows the capture button", () => {
    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "f" });
    expect(screen.getByTestId("mode-tab-fullScreen")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("fullscreen-capture-btn")).toBeInTheDocument();
  });

  it("pressing W switches to Window mode and triggers list_windows", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_windows") {
        return [
          { id: 42, title: "Cursor", app_name: "Cursor", width: 1920, height: 1080 },
          { id: 7, title: "VS Code", app_name: "Code", width: 1280, height: 720 },
        ];
      }
      return undefined;
    });
    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "w" });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_windows");
    });
    expect(await screen.findByTestId("window-card-42")).toBeInTheDocument();
    expect(screen.getByTestId("window-card-7")).toBeInTheDocument();
  });

  it("pressing R goes back from Full Screen to Region", () => {
    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "f" });
    expect(screen.queryByTestId("fullscreen-capture-btn")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "r" });
    expect(screen.queryByTestId("fullscreen-capture-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("mode-tab-region")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("clicking the Full Screen capture button calls capture_full_screen with screen offsets", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "capture_full_screen") return "C:/temp/cap.png";
      return undefined;
    });
    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "f" });
    fireEvent.click(screen.getByTestId("fullscreen-capture-btn"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "capture_full_screen",
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      );
    });
    // The Edit / Save prompt opens after the capture resolves.
    expect(await screen.findByTestId("prompt-edit")).toBeInTheDocument();
  });

  it("clicking a window card calls capture_window with the picked id", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "list_windows") {
        return [
          { id: 42, title: "Cursor", app_name: "Cursor", width: 1920, height: 1080 },
        ];
      }
      if (cmd === "capture_window") {
        const a = args as { id: number };
        if (a?.id === 42) return "C:/temp/cap.png";
      }
      return undefined;
    });
    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "w" });
    const card = await screen.findByTestId("window-card-42");
    fireEvent.click(card);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("capture_window", { id: 42 });
    });
    expect(await screen.findByTestId("prompt-edit")).toBeInTheDocument();
  });

  it("region drag is ignored once the user has switched to Full Screen", () => {
    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "f" });
    const surface = screen.getByTestId("overlay-surface");
    fireEvent.mouseDown(surface, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(surface, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(surface, { clientX: 300, clientY: 300 });
    expect(invoke).not.toHaveBeenCalledWith(
      "capture_region",
      expect.anything(),
    );
  });

  it("Window picker shows the empty-state when list_windows returns []", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_windows") return [];
      return undefined;
    });
    render(<OverlayWindow />);
    fireEvent.keyDown(document, { key: "w" });
    expect(await screen.findByText(/no windows available/i)).toBeInTheDocument();
  });
});
