import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sendNotification } from "@tauri-apps/plugin-notification";
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { t } from "@/i18n";
import { UploaderToast } from "./UploaderToast";

const MIN_SELECTION_PX = 10;
const SUCCESS_DISPLAY_MS = 1800;

interface Point {
  x: number;
  y: number;
}

/**
 * `selecting` — drag-to-select state, the dimmed overlay
 * `prompting` — selection done, capture saved, asking the user "Edit or Save"
 * `uploading` / `success` — direct-save flow toast (annotation skipped)
 */
type Mode = "selecting" | "prompting" | "uploading" | "success";

/** Forward a log line to the Rust dev terminal — DevTools on the overlay
 *  window are unreachable because the window hides on success. */
function dlog(message: string) {
  console.log(message);
  void invoke("debug_log", { message }).catch(() => {});
}

export function OverlayWindow() {
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [mode, setMode] = useState<Mode>("selecting");
  /** Path of the freshly-captured screenshot — handed to either the
   *  annotator (Edit) or upload_screenshot (Save). */
  const pendingPathRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  // Strip the opaque html/body background that the main stylesheet applies,
  // so the underlying desktop is visible through this transparent window.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.backgroundColor;
    const prevBodyBg = body.style.backgroundColor;
    const prevHtmlClass = html.className;
    const prevBodyClass = body.className;
    html.style.backgroundColor = "transparent";
    body.style.backgroundColor = "transparent";
    body.classList.add("overlay-mode");
    return () => {
      html.style.backgroundColor = prevHtmlBg;
      body.style.backgroundColor = prevBodyBg;
      html.className = prevHtmlClass;
      body.className = prevBodyClass;
    };
  }, []);

  const cancelPrompt = async () => {
    pendingPathRef.current = null;
    setMode("selecting");
    busyRef.current = false;
    try {
      await getCurrentWebviewWindow().hide();
    } catch {
      // ignored
    }
  };

  // Keyboard shortcuts on the overlay:
  //   ESC          — cancel from any state
  //   E (in prompt) — Edit (open annotator)
  //   S (in prompt) — Save (direct upload)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode === "selecting") {
          void getCurrentWebviewWindow().hide();
        } else if (mode === "prompting") {
          void cancelPrompt();
        }
      } else if (mode === "prompting") {
        if (e.key === "e" || e.key === "E") {
          e.preventDefault();
          void chooseEdit();
        } else if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          void chooseSave();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode !== "selecting") return;
    setStart({ x: e.clientX, y: e.clientY });
    setCurrent({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (mode !== "selecting" || !start) return;
    setCurrent({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    if (mode !== "selecting" || !start || busyRef.current) return;

    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const width = Math.abs(e.clientX - start.x);
    const height = Math.abs(e.clientY - start.y);

    setStart(null);
    setCurrent(null);

    if (width < MIN_SELECTION_PX || height < MIN_SELECTION_PX) {
      return;
    }

    busyRef.current = true;
    const win = getCurrentWebviewWindow();

    try {
      // Hide the overlay window so it isn't part of the screenshot itself.
      await win.hide();
      await new Promise((r) => window.setTimeout(r, 100));

      dlog(
        `[overlay] capture_region x=${Math.round(x)} y=${Math.round(y)} w=${Math.round(width)} h=${Math.round(height)}`,
      );
      const imagePath = await invoke<string>("capture_region", {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
      dlog(`[overlay] captured to: ${imagePath}`);

      pendingPathRef.current = imagePath;

      // Re-show the overlay in `prompting` mode — this turns the fullscreen
      // dimmed surface into the Edit / Save dialog.
      setMode("prompting");
      await new Promise((r) => window.setTimeout(r, 0));
      await win.show();
      await win.setFocus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`[overlay] capture FAILED: ${msg}`);
      try {
        sendNotification({
          title: t("notify.error"),
          body: msg.slice(0, 200),
        });
      } catch {
        // ignored
      }
      try {
        await win.hide();
      } catch {
        // ignored
      }
      setMode("selecting");
      busyRef.current = false;
    }
  };

  /** User clicked Edit → hand the captured PNG to the annotator window. */
  const chooseEdit = async () => {
    const path = pendingPathRef.current;
    if (!path) return;
    pendingPathRef.current = null;
    try {
      await getCurrentWebviewWindow().hide();
      const annotator = await WebviewWindow.getByLabel("annotator");
      if (annotator) {
        await annotator.show();
        await annotator.setFocus();
      }
      await emit("annotator-load", { path });
      dlog(`[overlay] -> annotator: ${path}`);
    } catch (err) {
      dlog(`[overlay] open annotator FAILED: ${err}`);
    } finally {
      setMode("selecting");
      busyRef.current = false;
    }
  };

  /** Upload a path through the existing toast flow. Used both by Save
   *  (legacy direct upload) and by the annotator's Done click (which
   *  emits `upload-from-path` so the toast doesn't have to live inside
   *  the editor window). */
  const uploadAndToast = async (path: string) => {
    const win = getCurrentWebviewWindow();
    busyRef.current = true;
    try {
      setMode("uploading");
      await new Promise((r) => window.setTimeout(r, 0));
      await win.show();
      await win.setFocus();
      const link = await invoke<string>("upload_screenshot", {
        imagePath: path,
      });
      dlog(`[overlay] upload OK, link: ${link}`);
      await writeText(link);
      setMode("success");
      try {
        sendNotification({
          title: t("notify.app_name"),
          body: t("notify.link_copied"),
        });
      } catch (notifyErr) {
        dlog(`[overlay] notification failed (non-fatal): ${notifyErr}`);
      }
      await new Promise((r) => window.setTimeout(r, SUCCESS_DISPLAY_MS));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`[overlay] upload FAILED: ${msg}`);
      try {
        sendNotification({
          title: t("notify.error"),
          body: msg.slice(0, 200),
        });
      } catch {
        // ignored
      }
    } finally {
      try {
        await win.hide();
      } catch {
        // ignored
      }
      setMode("selecting");
      busyRef.current = false;
    }
  };

  /** User clicked Save → upload the captured PNG without annotating. */
  const chooseSave = async () => {
    const path = pendingPathRef.current;
    if (!path) return;
    pendingPathRef.current = null;
    await uploadAndToast(path);
  };

  // Listen for the annotator's "Done" hand-off: the editor saves the
  // annotated PNG to disk, hides itself, then asks us to handle the
  // upload + toast.
  useEffect(() => {
    const off = listen<{ path: string }>("upload-from-path", (e) => {
      void uploadAndToast(e.payload.path);
    });
    return () => {
      void off.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rect =
    mode === "selecting" && start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  // Backdrop: dim the screen while choosing/uploading; transparent during
  // a fresh selection drag (so the user can see what they're framing).
  const surfaceBg =
    mode === "prompting"
      ? "rgba(0,0,0,0.55)"
      : mode === "selecting"
        ? rect
          ? "transparent"
          : "rgba(0,0,0,0.18)"
        : "transparent";
  const cursorClass =
    mode === "selecting" ? "cursor-crosshair" : "cursor-default";

  return (
    <div
      data-testid="overlay-surface"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={`w-screen h-screen relative overflow-hidden ${cursorClass}`}
      style={{ backgroundColor: surfaceBg }}
    >
      {rect && (
        <div
          aria-label="selection"
          className="absolute border-2 border-dashed border-white pointer-events-none"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            backgroundColor: "transparent",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          }}
        >
          <span className="absolute -bottom-6 left-0 text-xs text-white bg-black/70 px-2 py-0.5 rounded">
            {rect.width} × {rect.height}
          </span>
        </div>
      )}
      {mode === "selecting" && !start && (
        <p className="absolute top-6 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-4 py-2 rounded-full pointer-events-none shadow-lg">
          {t("overlay.hint")}
        </p>
      )}
      {mode === "prompting" && (
        <div
          data-testid="overlay-prompt"
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="bg-slate-900/95 border border-slate-700 rounded-2xl shadow-2xl px-8 py-7 flex flex-col items-center gap-5 min-w-[340px]">
            <h2 className="text-white text-lg font-semibold">
              {t("overlay.prompt.title")}
            </h2>
            <div className="flex gap-3">
              <button
                type="button"
                data-testid="prompt-edit"
                onClick={() => void chooseEdit()}
                className="px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-dark text-white text-sm font-medium"
              >
                {t("overlay.prompt.edit")}
              </button>
              <button
                type="button"
                data-testid="prompt-save"
                onClick={() => void chooseSave()}
                className="px-5 py-2.5 rounded-lg bg-success hover:bg-emerald-600 text-white text-sm font-medium"
              >
                {t("overlay.prompt.save")}
              </button>
            </div>
            <p className="text-xs text-slate-400">{t("overlay.prompt.hint")}</p>
          </div>
        </div>
      )}
      {(mode === "uploading" || mode === "success") && (
        <UploaderToast state={mode} />
      )}
    </div>
  );
}
