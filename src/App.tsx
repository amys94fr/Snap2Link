import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLanguage } from "./i18n";
import { useAppStore, type AppPage } from "./store/appStore";
import { SetupWizard } from "./windows/SetupWizard";
import { SettingsWindow } from "./windows/SettingsWindow";
import { OverlayWindow } from "./windows/OverlayWindow";
import { AnnotatorWindow } from "./windows/AnnotatorWindow";
import { ToastWindow } from "./windows/ToastWindow";

type WindowKind = "main" | "overlay" | "annotator" | "toast";

function getWindowKind(): WindowKind {
  if (typeof window === "undefined") return "main";
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("window");
  if (kind === "overlay") return "overlay";
  if (kind === "annotator") return "annotator";
  if (kind === "toast") return "toast";
  return "main";
}

export default function App() {
  useLanguage();
  const kind = getWindowKind();
  if (kind === "overlay") return <OverlayWindow />;
  if (kind === "annotator") return <AnnotatorWindow />;
  if (kind === "toast") return <ToastWindow />;
  return <MainApp />;
}

function MainApp() {
  const {
    setPage,
    setCategory,
    setupDone,
    setSetupDone,
    autoCheckUpdates,
    requestAutoCheckUpdates,
    consumeAutoCheckUpdates,
  } = useAppStore();

  useEffect(() => {
    void invoke<boolean>("is_first_run").then((first) => setSetupDone(!first));

    const unlistenPromise = listen<string>("navigate", async (e) => {
      const p = e.payload;
      if (p === "wizard" || p === "settings" || p === "about") {
        setPage(p as AppPage);
      } else if (p === "check-updates") {
        requestAutoCheckUpdates();
      } else if (p === "account") {
        setPage("settings");
        setCategory("hosting");
      }
      // Whenever the tray asks us to navigate we also need to make sure
      // the main window is visible.
      try {
        const win = getCurrentWebviewWindow();
        await win.show();
        await win.setFocus();
      } catch {
        // not running inside Tauri (tests)
      }
    });
    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, [setSetupDone, setPage, requestAutoCheckUpdates]);

  if (!setupDone) {
    return (
      <SetupWizard
        onComplete={() => {
          setSetupDone(true);
          setPage("settings");
        }}
      />
    );
  }

  return (
    <SettingsWindow
      autoCheckUpdates={autoCheckUpdates}
      onUpdatesChecked={consumeAutoCheckUpdates}
    />
  );
}
