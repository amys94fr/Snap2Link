import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sendNotification } from "@tauri-apps/plugin-notification";
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import clsx from "clsx";
import { t } from "@/i18n";
import type {
  LastAfter,
  LastMode,
  ProfileAfter,
  ProfileMode,
} from "@/lib/config";

const MIN_SELECTION_PX = 10;
const HIDE_BEFORE_CAPTURE_MS = 100;

interface Point {
  x: number;
  y: number;
}

interface WindowInfo {
  id: number;
  title: string;
  app_name: string;
  width: number;
  height: number;
}

/**
 * The overall flow stage:
 *   selecting  : the overlay is up, user picks region / mode
 *   prompting  : capture saved, asking the user "Edit or Save"
 * Uploads run with the overlay hidden: the toast window reports them.
 */
type Mode = "selecting" | "prompting";

/** Which capture mode the overlay is in while `mode === "selecting"`. */
type CaptureMode = LastMode;

/** Sent by Rust when a shortcut or the tray starts a capture. */
interface CaptureRequest {
  mode: ProfileMode;
  after: ProfileAfter;
  last_mode: LastMode | null;
  last_after: LastAfter | null;
}

/** Upload failures Rust reports as codes, with what to show for each. */
const UPLOAD_ERRORS: Record<string, string> = {
  relay_daily_limit: "uploader.error.daily_limit",
  relay_service_busy: "uploader.error.service_busy",
  relay_too_large: "uploader.error.too_large",
  relay_unreachable: "uploader.error.unreachable",
  relay_guest_required: "uploader.error.verification_failed",
  relay_verification_failed: "uploader.error.verification_failed",
  relay_guest_cancelled: "uploader.error.verification_cancelled",
  relay_guest_banned: "uploader.error.banned",
  drive_not_connected: "uploader.error.drive_not_connected",
};

const ASK_EVERYTHING: CaptureRequest = {
  mode: "ask",
  after: "ask",
  last_mode: null,
  last_after: null,
};

/** Forward a log line to the Rust dev terminal. The overlay window's
 *  DevTools are unreachable because the window hides on success. */
function dlog(message: string) {
  console.log(message);
  void invoke("debug_log", { message }).catch(() => {});
}

export function OverlayWindow() {
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [mode, setMode] = useState<Mode>("selecting");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("region");
  const [windows, setWindows] = useState<WindowInfo[] | null>(null);
  /** Path of the freshly-captured screenshot, handed to either the
   *  annotator (Edit) or upload_screenshot (Save). */
  const pendingPathRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  /** What the shortcut asked for, read once the image exists. */
  const requestRef = useRef<CaptureRequest>(ASK_EVERYTHING);
  /** Overlay tab that produced the pending capture. */
  const usedModeRef = useRef<CaptureMode>("region");
  /** Prompt button Enter validates. */
  const [preferred, setPreferred] = useState<LastAfter>("save");
  const preferredRef = useRef<LastAfter>("save");

  // Strip the opaque html/body background that the main stylesheet
  // applies, so the underlying desktop is visible through this
  // transparent window.
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

  // Reset to a clean "selecting / region" state every time the overlay
  // is shown (the window stays alive between captures, so we mustn't
  // carry over stale prompt or window-picker state).
  useEffect(() => {
    if (mode === "selecting") {
      setStart(null);
      setCurrent(null);
    }
  }, [mode]);

  /** Switch capture mode. Resets per-mode transient state. */
  const switchCaptureMode = useCallback((next: CaptureMode) => {
    setCaptureMode(next);
    setStart(null);
    setCurrent(null);
    if (next === "window") {
      setWindows(null);
      void invoke<WindowInfo[]>("list_windows")
        .then(setWindows)
        .catch((err) => {
          dlog(`[overlay] list_windows FAILED: ${err}`);
          setWindows([]);
        });
    } else {
      setWindows(null);
    }
  }, []);

  const cancelPrompt = async () => {
    pendingPathRef.current = null;
    setMode("selecting");
    busyRef.current = false;
    try {
      await getCurrentWebviewWindow().hide();
    } catch {
      /* ignored */
    }
  };

  /** Shared handler for after any successful capture: stash the path
   *  and switch the overlay into "Edit / Save" prompt mode. */
  const enterPromptMode = async (imagePath: string) => {
    pendingPathRef.current = imagePath;
    setMode("prompting");
    await new Promise((r) => window.setTimeout(r, 0));
    const win = getCurrentWebviewWindow();
    try {
      await win.show();
      await win.setFocus();
    } catch {
      /* ignored */
    }
  };

  /** Follows what the shortcut set for the step after the capture. */
  const finishCapture = async (imagePath: string) => {
    pendingPathRef.current = imagePath;
    const { after } = requestRef.current;
    if (after === "share") await chooseSave();
    else if (after === "annotate") await chooseEdit();
    else await enterPromptMode(imagePath);
  };

  /** Only steps left on "Ask" are remembered, once the capture went through. */
  const remember = (after: LastAfter) => {
    const request = requestRef.current;
    const mode = request.mode === "ask" ? usedModeRef.current : null;
    const choice = request.after === "ask" ? after : null;
    if (!mode && !choice) return;
    void Promise.resolve(
      invoke("save_last_choice", { mode, after: choice }),
    ).catch((err) => dlog(`[overlay] save_last_choice FAILED: ${err}`));
  };

  /** Shared error path for capture failures. Notify, hide overlay,
   *  reset to selecting region mode. */
  const handleCaptureError = async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    dlog(`[overlay] capture FAILED: ${msg}`);
    try {
      sendNotification({
        title: t("notify.error"),
        body: msg.slice(0, 200),
      });
    } catch {
      /* ignored */
    }
    try {
      await getCurrentWebviewWindow().hide();
    } catch {
      /* ignored */
    }
    setMode("selecting");
    setCaptureMode("region");
    busyRef.current = false;
  };

  /** Region capture: from the live drag rectangle. */
  const captureRegion = async (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    if (busyRef.current) return;
    if (width < MIN_SELECTION_PX || height < MIN_SELECTION_PX) return;
    busyRef.current = true;
    const win = getCurrentWebviewWindow();
    try {
      await win.hide();
      await new Promise((r) => window.setTimeout(r, HIDE_BEFORE_CAPTURE_MS));
      usedModeRef.current = "region";
      dlog(`[overlay] capture_region x=${x} y=${y} w=${width} h=${height}`);
      const path = await invoke<string>("capture_region", {
        x,
        y,
        width,
        height,
      });
      dlog(`[overlay] captured to: ${path}`);
      await finishCapture(path);
    } catch (err) {
      await handleCaptureError(err);
    }
  };

  /** Full-screen capture: capture the monitor the overlay sits on. */
  const captureFullScreen = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const win = getCurrentWebviewWindow();
    try {
      // Pick screen by passing the cursor position. screenX/screenY give
      // the global coordinates so multi-monitor setups capture the
      // *current* monitor, not the primary one.
      const x = Math.round(window.screenX);
      const y = Math.round(window.screenY);
      await win.hide();
      await new Promise((r) => window.setTimeout(r, HIDE_BEFORE_CAPTURE_MS));
      usedModeRef.current = "fullScreen";
      dlog(`[overlay] capture_full_screen at x=${x} y=${y}`);
      const path = await invoke<string>("capture_full_screen", { x, y });
      dlog(`[overlay] captured to: ${path}`);
      await finishCapture(path);
    } catch (err) {
      await handleCaptureError(err);
    }
  };

  /** Window capture: fired when the user clicks one of the window cards. */
  const captureWindow = async (id: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const win = getCurrentWebviewWindow();
    try {
      await win.hide();
      // Window capture wants the overlay AND any of our own windows out
      // of the way before xcap reads the framebuffer.
      await new Promise((r) => window.setTimeout(r, HIDE_BEFORE_CAPTURE_MS));
      usedModeRef.current = "window";
      dlog(`[overlay] capture_window id=${id}`);
      const path = await invoke<string>("capture_window", { id });
      dlog(`[overlay] captured to: ${path}`);
      await finishCapture(path);
    } catch (err) {
      await handleCaptureError(err);
    }
  };

  const showOverlay = async () => {
    const win = getCurrentWebviewWindow();
    try {
      await win.show();
      await win.setFocus();
    } catch (err) {
      dlog(`[overlay] could not open: ${err}`);
    }
  };

  /** Full screen or active window, set in advance: no overlay at all. */
  const captureDirect = async (mode: "full_screen" | "active_window") => {
    busyRef.current = true;
    try {
      const command =
        mode === "full_screen" ? "capture_at_cursor" : "capture_active_window";
      dlog(`[overlay] ${command}`);
      await finishCapture(await invoke<string>(command));
    } catch (err) {
      // Nothing in front (desktop, or the OS won't say): let the user pick.
      if (mode === "active_window" && String(err).includes("no_active_window")) {
        busyRef.current = false;
        switchCaptureMode("window");
        await showOverlay();
        return;
      }
      await handleCaptureError(err);
    }
  };

  const handleTrigger = async (request: CaptureRequest) => {
    if (busyRef.current) return;
    requestRef.current = request;
    preferredRef.current = request.last_after ?? "save";
    setPreferred(preferredRef.current);
    setMode("selecting");

    // A toast left on screen must not end up in the capture.
    try {
      if (await invoke<boolean>("hide_toast")) {
        await new Promise((r) => window.setTimeout(r, HIDE_BEFORE_CAPTURE_MS));
      }
    } catch {
      /* ignored */
    }

    if (request.mode === "full_screen" || request.mode === "active_window") {
      await captureDirect(request.mode);
      return;
    }
    switchCaptureMode(
      request.mode === "region" ? "region" : (request.last_mode ?? "region"),
    );
    await showOverlay();
  };

  useEffect(() => {
    const off = listen<CaptureRequest>("trigger-screenshot", (e) => {
      void handleTrigger(e.payload);
    });
    return () => {
      void off.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts.
  //   ESC  : cancel from any state
  //   while selecting: R / F / W switch capture mode
  //   while prompting: E edit, S save, Enter confirms the preselected choice
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode === "selecting") {
          void getCurrentWebviewWindow().hide();
        } else if (mode === "prompting") {
          void cancelPrompt();
        }
        return;
      }
      if (mode === "selecting") {
        const k = e.key.toLowerCase();
        if (k === "r") {
          e.preventDefault();
          switchCaptureMode("region");
        } else if (k === "f") {
          e.preventDefault();
          switchCaptureMode("fullScreen");
        } else if (k === "w") {
          e.preventDefault();
          switchCaptureMode("window");
        }
      } else if (mode === "prompting") {
        if (e.key === "e" || e.key === "E") {
          e.preventDefault();
          void chooseEdit();
        } else if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          void chooseSave();
        } else if (e.key === "Enter") {
          e.preventDefault();
          void (preferredRef.current === "edit" ? chooseEdit() : chooseSave());
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, switchCaptureMode]);

  // ── Region drag handlers ────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    if (mode !== "selecting" || captureMode !== "region") return;
    setStart({ x: e.clientX, y: e.clientY });
    setCurrent({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (mode !== "selecting" || captureMode !== "region" || !start) return;
    setCurrent({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = async (e: React.MouseEvent) => {
    if (mode !== "selecting" || captureMode !== "region" || !start) return;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const width = Math.abs(e.clientX - start.x);
    const height = Math.abs(e.clientY - start.y);
    setStart(null);
    setCurrent(null);
    await captureRegion(
      Math.round(x),
      Math.round(y),
      Math.round(width),
      Math.round(height),
    );
  };

  // ── Edit / Save / annotator hand-off ────────────────────────────────
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
      remember("edit");
    } catch (err) {
      dlog(`[overlay] open annotator FAILED: ${err}`);
    } finally {
      setMode("selecting");
      setCaptureMode("region");
      busyRef.current = false;
    }
  };

  const toast = async (state: "uploading" | "copied") => {
    try {
      await invoke("show_toast", { state });
      return true;
    } catch (err) {
      dlog(`[overlay] toast failed (non-fatal): ${err}`);
      return false;
    }
  };

  /** Uploads with the overlay gone: nothing covers the screen meanwhile. Also
   *  used by the annotator's Done click, through `upload-from-path`. */
  const uploadAndToast = async (path: string) => {
    const win = getCurrentWebviewWindow();
    busyRef.current = true;
    let uploaded = false;
    try {
      setMode("selecting");
      await win.hide();
      await toast("uploading");
      const link = await invoke<string>("upload_screenshot", {
        imagePath: path,
      });
      dlog(`[overlay] upload OK, link: ${link}`);
      await writeText(link);
      uploaded = true;
      if (!(await toast("copied"))) {
        sendNotification({
          title: t("notify.app_name"),
          body: t("notify.link_copied"),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`[overlay] upload FAILED: ${msg}`);
      void Promise.resolve(invoke("hide_toast")).catch(() => {});
      try {
        const known = UPLOAD_ERRORS[msg];
        sendNotification({
          title: t("notify.error"),
          body: known ? t(known) : msg.slice(0, 200),
        });
      } catch {
        /* ignored */
      }
    } finally {
      setMode("selecting");
      setCaptureMode("region");
      busyRef.current = false;
    }
    return uploaded;
  };

  const chooseSave = async () => {
    const path = pendingPathRef.current;
    if (!path) return;
    pendingPathRef.current = null;
    if (await uploadAndToast(path)) remember("save");
  };

  // Listen for the annotator's "Done" hand-off.
  useEffect(() => {
    const off = listen<{ path: string }>("upload-from-path", (e) => {
      void uploadAndToast(e.payload.path);
    });
    return () => {
      void off.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived render state ────────────────────────────────────────────
  const rect =
    mode === "selecting" && captureMode === "region" && start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  // Backdrop:
  //   - prompting: dimmed, the prompt card sits on top
  //   - region selecting: transparent if already drawing, else a subtle dim
  //   - fullScreen / window: subtle dim so the toolbar reads, but the user
  //     can still see the desktop / windows
  let surfaceBg = "transparent";
  if (mode === "prompting") surfaceBg = "rgba(0,0,0,0.55)";
  else if (mode === "selecting") {
    if (captureMode === "region")
      surfaceBg = rect ? "transparent" : "rgba(0,0,0,0.18)";
    else surfaceBg = "rgba(0,0,0,0.30)";
  }

  const cursorClass =
    mode === "selecting" && captureMode === "region"
      ? "cursor-crosshair"
      : "cursor-default";

  return (
    <div
      data-testid="overlay-surface"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={`w-screen h-screen relative overflow-hidden ${cursorClass}`}
      style={{ backgroundColor: surfaceBg }}
    >
      {/* Mode toolbar at the top — visible only while picking a capture */}
      {mode === "selecting" && (
        <ModeToolbar mode={captureMode} onSwitch={switchCaptureMode} />
      )}

      {/* Region: live drag rectangle */}
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

      {/* Region: hint pill before the user starts dragging */}
      {mode === "selecting" && captureMode === "region" && !start && (
        <p className="absolute top-24 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-4 py-2 rounded-full pointer-events-none shadow-lg">
          {t("overlay.hint")}
        </p>
      )}

      {/* Full-screen mode card */}
      {mode === "selecting" && captureMode === "fullScreen" && (
        <FullScreenPanel onCapture={captureFullScreen} />
      )}

      {/* Window picker mode */}
      {mode === "selecting" && captureMode === "window" && (
        <WindowPicker windows={windows} onPick={captureWindow} />
      )}

      {/* Edit / Save prompt */}
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
                data-preferred={preferred === "edit"}
                onClick={() => void chooseEdit()}
                className={promptButton(preferred === "edit")}
              >
                {t("overlay.prompt.edit")}
              </button>
              <button
                type="button"
                data-testid="prompt-save"
                data-preferred={preferred === "save"}
                onClick={() => void chooseSave()}
                className={promptButton(preferred === "save")}
              >
                {t("overlay.prompt.save")}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              {t("overlay.prompt.hint")}
            </p>
          </div>
        </div>
      )}

    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

/** The preselected choice stands out: it is what Enter confirms. */
function promptButton(preferred: boolean) {
  return clsx(
    "min-h-11 px-5 rounded-lg text-sm font-medium text-white",
    preferred
      ? "bg-brand hover:bg-brand-dark ring-2 ring-blue-300"
      : "bg-slate-800 hover:bg-slate-700",
  );
}

function ModeToolbar({
  mode,
  onSwitch,
}: {
  mode: CaptureMode;
  onSwitch: (m: CaptureMode) => void;
}) {
  const tabs: Array<{ id: CaptureMode; labelKey: string; shortcut: string }> = [
    { id: "region", labelKey: "overlay.mode.region", shortcut: "R" },
    {
      id: "fullScreen",
      labelKey: "overlay.mode.fullscreen",
      shortcut: "F",
    },
    { id: "window", labelKey: "overlay.mode.window", shortcut: "W" },
  ];
  return (
    <div
      data-testid="overlay-mode-toolbar"
      className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10"
    >
      <div className="flex bg-slate-900/90 border border-slate-700 rounded-full p-1 backdrop-blur-sm shadow-xl">
        {tabs.map((tab) => {
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`mode-tab-${tab.id}`}
              data-active={active}
              onClick={() => onSwitch(tab.id)}
              className={
                "px-4 py-2 rounded-full text-sm font-medium transition flex items-center gap-2 " +
                (active
                  ? "bg-brand text-white shadow"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/70")
              }
            >
              <span>{t(tab.labelKey)}</span>
              <kbd
                className={
                  "text-[10px] font-mono px-1.5 py-0.5 rounded " +
                  (active
                    ? "bg-white/20 text-white"
                    : "bg-slate-800/70 text-slate-400")
                }
              >
                {tab.shortcut}
              </kbd>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-300/80 bg-black/40 px-3 py-1 rounded-full pointer-events-none">
        {t("overlay.mode.hint")}
      </p>
    </div>
  );
}

function FullScreenPanel({ onCapture }: { onCapture: () => void }) {
  return (
    <div
      data-testid="overlay-fullscreen"
      className="absolute inset-0 flex items-center justify-center"
    >
      <button
        type="button"
        data-testid="fullscreen-capture-btn"
        onClick={() => void onCapture()}
        className="px-8 py-5 rounded-2xl bg-slate-900/95 border border-slate-700 hover:border-brand hover:bg-slate-900 transition shadow-2xl flex flex-col items-center gap-2 min-w-[320px]"
      >
        <span className="text-white text-lg font-semibold">
          {t("overlay.fullscreen.cta")}
        </span>
        <span className="text-xs text-slate-400">
          {t("overlay.fullscreen.subtitle")}
        </span>
      </button>
    </div>
  );
}

function WindowPicker({
  windows,
  onPick,
}: {
  windows: WindowInfo[] | null;
  onPick: (id: number) => void;
}) {
  return (
    <div
      data-testid="overlay-window-picker"
      className="absolute inset-0 flex items-start justify-center pt-32 px-6 pb-6 overflow-auto"
    >
      <div className="w-full max-w-3xl flex flex-col gap-4">
        <div className="text-center">
          <h2 className="text-white text-lg font-semibold">
            {t("overlay.window.title")}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {t("overlay.window.subtitle")}
          </p>
        </div>
        {windows === null ? (
          <p className="text-center text-slate-300 text-sm py-12">
            {t("overlay.window.loading")}
          </p>
        ) : windows.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-12">
            {t("overlay.window.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {windows.map((w) => (
              <button
                key={w.id}
                type="button"
                data-testid={`window-card-${w.id}`}
                onClick={() => void onPick(w.id)}
                className="text-start bg-slate-900/95 border border-slate-700 hover:border-brand hover:bg-slate-900 rounded-xl px-4 py-3 transition shadow-lg flex flex-col gap-1"
              >
                <span className="text-sm font-medium text-white truncate">
                  {w.title || w.app_name || `#${w.id}`}
                </span>
                <span className="text-xs text-slate-400 truncate flex items-center justify-between">
                  <span>{w.app_name || "·"}</span>
                  <span className="font-mono">
                    {w.width} × {w.height}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
