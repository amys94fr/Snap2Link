import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "@/i18n";
import {
  useAnnotatorStore,
  type AnnotatorTool,
} from "@/store/annotatorStore";
import { AnnotatorToolbar } from "@/components/AnnotatorToolbar";
import { AnnotatorCanvas } from "@/components/AnnotatorCanvas";

const MAX_CANVAS_DIMENSION = 1600; // visual cap so huge captures still fit

interface LoadedImage {
  el: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
}

function readPathParam(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search).get("path");
  return p ? decodeURIComponent(p) : null;
}

/** Decode a `data:image/png;base64,...` URL into raw bytes that Tauri's
 *  `Vec<u8>` command expects. */
function dataUrlToBytes(dataUrl: string): number[] {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("malformed data URL");
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const arr = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

const TOOL_KEYS: Record<string, AnnotatorTool> = {
  v: "select",
  p: "pen",
  r: "rectangle",
  o: "circle",
  a: "arrow",
  t: "text",
  b: "blur",
};

/**
 * Annotator window — opens after the overlay capture, lets the user draw
 * arrows / shapes / blur / text on top of the screenshot before it gets
 * uploaded. The Konva stage handles drawing; the keyboard handler here
 * wires tool shortcuts and undo / redo.
 */
export function AnnotatorWindow() {
  const initialPath = useMemo(() => readPathParam(), []);
  const [imagePath, setImagePath] = useState<string | null>(initialPath);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = useAnnotatorStore((s) => s.reset);
  const setTool = useAnnotatorStore((s) => s.setTool);
  const undo = useAnnotatorStore((s) => s.undo);
  const redo = useAnnotatorStore((s) => s.redo);
  const past = useAnnotatorStore((s) => s.past);
  const future = useAnnotatorStore((s) => s.future);
  const stageRef = useRef<Konva.Stage | null>(null);

  // The overlay window emits `annotator-load` after every capture so the
  // same long-lived annotator window can serve back-to-back screenshots.
  useEffect(() => {
    const off = listen<{ path: string }>("annotator-load", (e) => {
      reset();
      setImage(null);
      setLoadError(null);
      setImagePath(e.payload.path);
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, [reset]);

  useEffect(() => {
    reset();
    if (!imagePath) {
      // No path yet — the overlay emits annotator-load on every capture.
      // The neutral "loading capture…" text already covers this state.
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setImage({
        el: img,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    };
    img.onerror = (e) => {
      const msg = typeof e === "string" ? e : "image load failed";
      setLoadError(msg);
    };
    try {
      img.src = convertFileSrc(imagePath) + `?t=${Date.now()}`;
    } catch {
      // outside Tauri (test env) — direct path is fine
      img.src = imagePath;
    }
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imagePath, reset]);

  /**
   * Keyboard shortcuts. We deliberately bail out when the user is typing
   * inside the inline text editor (textarea has focus) so the letters
   * land in the document, not the tool palette.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (ctrl && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      // Delete/Backspace removes the currently selected shape. We read
      // the latest store state inside the handler instead of trusting the
      // closure — selection updates from Konva clicks happen outside the
      // React render cycle and would otherwise see a stale value.
      if ((e.key === "Delete" || e.key === "Backspace") && !ctrl) {
        const sid = useAnnotatorStore.getState().selectedId;
        if (sid) {
          e.preventDefault();
          useAnnotatorStore.getState().deleteShape(sid);
          return;
        }
      }
      const k = e.key.toLowerCase();
      if (TOOL_KEYS[k] && !ctrl && !e.altKey) {
        e.preventDefault();
        setTool(TOOL_KEYS[k]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTool, undo, redo]);

  const hide = async () => {
    try {
      await getCurrentWebviewWindow().hide();
    } catch {
      // not in Tauri (tests)
    }
  };

  /** Cancel = drop the current capture and hide the window. The overlay
   *  will re-show this same window for the next capture. */
  const onCancel = async () => {
    reset();
    await hide();
  };

  /** Done = export Konva stage to PNG, dismiss the editor *immediately*
   *  so the user gets a clear "I'm done" signal, then hand the saved
   *  path off to the overlay window which drives the upload + toast.
   *  Keeping the toast in the overlay (a separate window) means the
   *  editor doesn't sit half-visible behind a centered spinner. */
  const onDone = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const stage = stageRef.current;
      if (!stage) throw new Error("stage not ready");
      // Export at native (un-scaled) image resolution so the upload keeps
      // its original sharpness even when the canvas was downscaled to fit.
      const dataUrl = stage.toDataURL({
        mimeType: "image/png",
        pixelRatio: stageSize.scale ? 1 / stageSize.scale : 1,
      });
      const bytes = dataUrlToBytes(dataUrl);
      const path = await invoke<string>("write_annotated_image", { bytes });
      // Dismiss the editor before kicking off the upload so the toast in
      // the overlay window stands alone instead of overlapping the canvas.
      reset();
      await hide();
      await emit("upload-from-path", { path });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        sendNotification({
          title: t("notify.error"),
          body: msg.slice(0, 200),
        });
      } catch {
        // ignored
      }
    } finally {
      setBusy(false);
    }
  };

  const stageSize = useMemo(() => {
    if (!image) return { width: 0, height: 0, scale: 1 };
    const { naturalWidth: w, naturalHeight: h } = image;
    const longest = Math.max(w, h);
    const scale = longest > MAX_CANVAS_DIMENSION ? MAX_CANVAS_DIMENSION / longest : 1;
    return { width: Math.round(w * scale), height: Math.round(h * scale), scale };
  }, [image]);

  return (
    <div
      data-testid="annotator-root"
      className="w-screen h-screen flex bg-slate-950 text-slate-100 overflow-hidden"
    >
      {/* Left toolbar */}
      <AnnotatorToolbar />

      {/* Canvas area */}
      <main className="flex-1 relative flex items-center justify-center overflow-auto">
        {!image && !loadError && (
          <p className="text-slate-400 text-sm">{t("annotator.loading")}</p>
        )}
        {loadError && (
          <p className="text-red-400 text-sm" data-testid="annotator-error">
            {loadError}
          </p>
        )}
        {image && (
          <AnnotatorCanvas
            image={image.el}
            width={stageSize.width}
            height={stageSize.height}
            onStageReady={(s) => {
              stageRef.current = s;
            }}
          />
        )}
      </main>

      {/* Bottom-right actions */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        <button
          type="button"
          data-testid="annotator-undo"
          onClick={undo}
          disabled={past.length === 0}
          aria-label={t("annotator.undo") + " (Ctrl+Z)"}
          title={t("annotator.undo") + " (Ctrl+Z)"}
          className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-sm"
        >
          ↶
        </button>
        <button
          type="button"
          data-testid="annotator-redo"
          onClick={redo}
          disabled={future.length === 0}
          aria-label={t("annotator.redo") + " (Ctrl+Y)"}
          title={t("annotator.redo") + " (Ctrl+Y)"}
          className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-sm"
        >
          ↷
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 text-sm"
        >
          {t("annotator.cancel")}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={busy || !image}
          className="px-4 py-2 rounded-md bg-brand hover:bg-brand-dark disabled:opacity-50 text-white text-sm font-medium"
        >
          {t("annotator.done")}
        </button>
      </div>
    </div>
  );
}
