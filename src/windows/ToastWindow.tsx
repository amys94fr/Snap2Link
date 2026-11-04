import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { UploaderToast, type UploaderState } from "./UploaderToast";

const VISIBLE_MS: Partial<Record<UploaderState, number>> = {
  copied: 15000,
  delete_failed: 15000,
  deleted: 2500,
};

/** Corner window showing the upload, then "Link copied" with a Delete button.
 *  Rust positions and shows it, this only follows the state it is sent. */
export function ToastWindow() {
  const [state, setState] = useState<UploaderState>("uploading");

  useEffect(() => {
    document.documentElement.style.backgroundColor = "transparent";
    document.body.classList.add("overlay-mode");
    const off = listen<UploaderState>("toast-state", (e) => setState(e.payload));
    return () => {
      void off.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const delay = VISIBLE_MS[state];
    if (delay === undefined) return;
    const id = window.setTimeout(() => {
      void getCurrentWebviewWindow().hide();
    }, delay);
    return () => window.clearTimeout(id);
  }, [state]);

  const deleteCapture = async () => {
    setState("deleting");
    try {
      await invoke("delete_last_upload");
      setState("deleted");
    } catch {
      setState("delete_failed");
    }
  };

  return <UploaderToast state={state} onDelete={() => void deleteCapture()} />;
}
