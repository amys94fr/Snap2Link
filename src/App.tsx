import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore, type AppPage } from "./store/appStore";
import { SetupWizard } from "./windows/SetupWizard";
import { SettingsWindow } from "./windows/SettingsWindow";
import { AboutWindow } from "./windows/AboutWindow";
import { OverlayWindow } from "./windows/OverlayWindow";
import { AnnotatorWindow } from "./windows/AnnotatorWindow";

type WindowKind = "main" | "overlay" | "annotator";

function getWindowKind(): WindowKind {
  if (typeof window === "undefined") return "main";
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("window");
  if (kind === "overlay") return "overlay";
  if (kind === "annotator") return "annotator";
  return "main";
}

export default function App() {
  const kind = getWindowKind();
  if (kind === "overlay") return <OverlayWindow />;
  if (kind === "annotator") return <AnnotatorWindow />;
  return <MainApp />;
}

function MainApp() {
  const {
    page,
    setPage,
    isAuthenticated,
    setAuthenticated,
    autoCheckUpdates,
    requestAutoCheckUpdates,
    consumeAutoCheckUpdates,
  } = useAppStore();

  useEffect(() => {
    void invoke<boolean>("is_authenticated").then(setAuthenticated);

    const unlistenPromise = listen<string>("navigate", async (e) => {
      const p = e.payload;
      if (p === "wizard" || p === "settings" || p === "about") {
        setPage(p as AppPage);
      } else if (p === "check-updates") {
        requestAutoCheckUpdates();
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
  }, [setAuthenticated, setPage, requestAutoCheckUpdates]);

  const closeWindow = async () => {
    try {
      await getCurrentWebviewWindow().hide();
    } catch {
      // ignored in test env
    }
    setPage("settings");
    consumeAutoCheckUpdates();
  };

  if (!isAuthenticated) {
    return (
      <SetupWizard
        onComplete={() => {
          setAuthenticated(true);
          setPage("settings");
        }}
      />
    );
  }

  if (page === "about") {
    return <AboutWindow onClose={closeWindow} />;
  }

  return (
    <SettingsWindow
      onClose={closeWindow}
      onAbout={() => setPage("about")}
      autoCheckUpdates={autoCheckUpdates}
    />
  );
}
