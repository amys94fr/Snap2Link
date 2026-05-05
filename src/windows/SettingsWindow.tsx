import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  isEnabled as autostartIsEnabled,
  enable as autostartEnable,
  disable as autostartDisable,
} from "@tauri-apps/plugin-autostart";
import { t } from "@/i18n";
import { HotkeyRecorder } from "@/components/HotkeyRecorder";
import { RetentionControl } from "@/components/RetentionControl";
import { UpdateChecker } from "@/components/UpdateChecker";
import clsx from "clsx";

interface Config {
  hotkey: string;
  retention_days: number;
  auto_delete: boolean;
}

interface Props {
  onClose: () => void;
  onAbout: () => void;
  /** When true, the UpdateChecker auto-runs a check as soon as Settings opens.
   *  Used when navigating from the tray "Check for Updates" entry. */
  autoCheckUpdates?: boolean;
}

const DRIVE_FOLDER_NAME = "Snap2Link";

const DEFAULT_CONFIG: Config = {
  hotkey: "Ctrl+PrintScreen",
  retention_days: 30,
  auto_delete: true,
};

export function SettingsWindow({ onClose, onAbout, autoCheckUpdates }: Props) {
  const [email, setEmail] = useState<string>("—");
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [accHint, setAccHint] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    void invoke<string | null>("get_account_email").then((e) =>
      setEmail(e ?? "—"),
    );
    void invoke<Config>("get_config").then(setConfig);
    void autostartIsEnabled().then(setStartupEnabled);
  }, []);

  const persistConfig = async (next: Config) => {
    setConfig(next);
    // Tauri converts args from camelCase (JS) to snake_case (Rust).
    await invoke("save_config", {
      hotkey: next.hotkey,
      retentionDays: next.retention_days,
      autoDelete: next.auto_delete,
    });
  };

  const handleSwitchAccount = async () => {
    setSwitching(true);
    setAccHint({ kind: "info", text: t("settings.switch_account.loading") });
    try {
      await invoke("disconnect");
      const mail = await invoke<string>("authenticate");
      setEmail(mail);
      setAccHint({
        kind: "success",
        text: t("settings.switch_account.success", { email: mail }),
      });
      window.setTimeout(() => setAccHint(null), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAccHint({
        kind: "error",
        text: t("settings.switch_account.error", { msg: msg.slice(0, 70) }),
      });
    } finally {
      setSwitching(false);
    }
  };

  const handleHotkeyChange = async (hotkey: string) => {
    await persistConfig({ ...config, hotkey });
    await invoke("update_hotkey", { hotkey });
  };

  const handleRetentionToggle = async (auto_delete: boolean) => {
    await persistConfig({ ...config, auto_delete });
  };

  const handleRetentionSave = async (retention_days: number) => {
    await persistConfig({ ...config, retention_days });
  };

  const handleStartupToggle = async () => {
    if (startupEnabled) {
      await autostartDisable();
      setStartupEnabled(false);
    } else {
      await autostartEnable();
      setStartupEnabled(true);
    }
  };

  return (
    <div className="bg-slate-950 text-slate-100 h-screen overflow-y-auto px-7 py-6">
      <h1 className="text-xl font-bold mb-3">{t("settings.heading")}</h1>
      <hr className="border-slate-800 mb-4" />

      <p className="text-xs text-slate-400">{t("settings.google_account")}</p>
      <div className="flex items-center justify-between mt-1 mb-1">
        <span className="text-sm font-medium truncate pr-3">{email}</span>
        <button
          type="button"
          onClick={handleSwitchAccount}
          disabled={switching}
          className="btn text-xs bg-slate-800 hover:bg-brand text-white px-3 py-1.5 rounded-lg whitespace-nowrap"
        >
          {t("settings.switch_account")}
        </button>
      </div>
      {accHint && (
        <p
          className={clsx(
            "text-xs mb-2",
            accHint.kind === "success"
              ? "text-success"
              : accHint.kind === "error"
                ? "text-danger"
                : "text-slate-400",
          )}
        >
          {accHint.text}
        </p>
      )}

      <p className="text-xs text-slate-400 mt-3">{t("settings.drive_folder")}</p>
      <p className="text-sm font-medium mb-4">{DRIVE_FOLDER_NAME}</p>

      <p className="text-xs text-slate-400">{t("settings.shortcut")}</p>
      <HotkeyRecorder current={config.hotkey} onChange={handleHotkeyChange} />

      <hr className="border-slate-800 my-3" />

      <RetentionControl
        days={config.retention_days}
        enabled={config.auto_delete}
        onToggle={handleRetentionToggle}
        onSave={handleRetentionSave}
      />

      <hr className="border-slate-800 my-3" />

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm font-medium">{t("settings.startup")}</span>
        <input
          type="checkbox"
          aria-label={t("settings.startup")}
          checked={startupEnabled}
          onChange={handleStartupToggle}
          className="w-10 h-5 accent-brand cursor-pointer"
        />
      </label>

      <hr className="border-slate-800 my-4" />

      <UpdateChecker autoStart={autoCheckUpdates} />

      <hr className="border-slate-800 my-4" />

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onAbout}
          className="btn bg-slate-800 hover:bg-slate-900 text-white text-sm px-4 py-2 rounded-lg"
        >
          {t("settings.about_btn")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="btn bg-brand hover:bg-brand-dark text-white text-sm px-4 py-2 rounded-lg"
        >
          {t("settings.close")}
        </button>
      </div>
    </div>
  );
}
