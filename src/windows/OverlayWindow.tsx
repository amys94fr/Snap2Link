import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sendNotification } from "@tauri-apps/plugin-notification";
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { t } from "@/i18n";
import { UploaderToast } from "./UploaderToast";

interface AppConfigShape {
  enable_annotator?: boolean;
}

const MIN_SELECTION_PX = 10;
const SUCCESS_DISPLAY_MS = 1800;

interface Point {
  x: number;
  y: number;
}

type Mode = "selecting" | "uploading" | "success";

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "selecting") {
        getCurrentWebviewWindow().hide();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
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
    let uploadedOk = false;

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

      // Branch on the user's preference: when the annotator is enabled,
      // hand the capture off to the annotator window and let it own the
      // upload. Otherwise upload immediately as before.
      const cfg = await invoke<AppConfigShape>("get_config").catch(
        () => ({}) as AppConfigShape,
      );
      const annotatorEnabled = cfg.enable_annotator !== false;

      if (annotatorEnabled) {
        const annotator = await WebviewWindow.getByLabel("annotator");
        if (annotator) {
          await annotator.show();
          await annotator.setFocus();
        }
        // Tell the annotator window which file to load. We can't reuse the
        // URL query param after the window is created, so emit an event.
        await emit("annotator-load", { path: imagePath });
        dlog(`[overlay] annotator handed: ${imagePath}`);
        uploadedOk = true; // not really uploaded, but the overlay is done
        return;
      }

      // Re-show the window in "uploading" mode — this turns the same
      // fullscreen overlay into a centered toast (via CSS flex centering).
      setMode("uploading");
      await new Promise((r) => window.setTimeout(r, 0));
      await win.show();

      const link = await invoke<string>("upload_screenshot", { imagePath });
      dlog(`[overlay] upload OK, link: ${link}`);

      await writeText(link);
      dlog("[overlay] clipboard write OK");
      uploadedOk = true;

      setMode("success");

      try {
        sendNotification({
          title: t("notify.app_name"),
          body: t("notify.link_copied"),
        });
      } catch (notifyErr) {
        dlog(`[overlay] notification failed (non-fatal): ${notifyErr}`);
      }

      // Linger on the success state so the user sees the confirmation.
      await new Promise((r) => window.setTimeout(r, SUCCESS_DISPLAY_MS));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`[overlay] FAILED: ${msg}`);
      try {
        sendNotification({
          title: t("notify.error"),
          body: msg.slice(0, 200),
        });
      } catch {
        // notifications might be denied — log already covers it.
      }
    } finally {
      try {
        await win.hide();
      } catch {
        // ignore
      }
      // Reset for the next capture.
      setMode("selecting");
      busyRef.current = false;
      void uploadedOk;
    }
  };

  const rect =
    mode === "selecting" && start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  // While the toast is being shown the overlay should not block the desktop
  // visually but still cover the screen for the spinner. We make it fully
  // transparent (no dim layer) and ignore pointer events.
  const surfaceBg =
    mode !== "selecting"
      ? "transparent"
      : rect
        ? "transparent"
        : "rgba(0,0,0,0.18)";
  const cursorClass = mode === "selecting" ? "cursor-crosshair" : "cursor-default";

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
      {mode !== "selecting" && <UploaderToast state={mode} />}
    </div>
  );
}
