import React from "react";
import ReactDOM from "react-dom/client";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import App from "./App";
import { initLanguage } from "./i18n";
import "./styles/globals.css";

void initLanguage().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

// Every window loads this file; only the main one asks for permissions.
if (!new URLSearchParams(window.location.search).has("window")) {
  // Ask the OS for permission to send notifications once at startup,
  // so error notifications can appear later.
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
}
