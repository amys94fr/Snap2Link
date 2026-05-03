import React from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import App from "./App";
import "./i18n";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Only the main window listens for the screenshot trigger; the overlay
// window itself is opened on demand.
const isOverlay = new URLSearchParams(window.location.search).get("window") === "overlay";

if (!isOverlay) {
  // Ask the OS for permission to send notifications once at startup,
  // so the success/error toasts can appear later.
  void (async () => {
    try {
      const granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        console.log("[snap2link] notification permission:", perm);
      }
    } catch (e) {
      console.warn("[snap2link] notification permission check failed:", e);
    }
  })();

  void listen("trigger-screenshot", async () => {
    console.log("[snap2link] trigger-screenshot received, opening overlay");
    try {
      const overlay = await WebviewWindow.getByLabel("overlay");
      if (!overlay) {
        console.error("[snap2link] overlay window not found");
        return;
      }
      await overlay.show();
      await overlay.setFocus();
    } catch (e) {
      console.error("[snap2link] could not open overlay:", e);
    }
  });
}
