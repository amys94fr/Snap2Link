import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "@/i18n";
import clsx from "clsx";

interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotes: string | null;
}

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up_to_date"; current: string }
  | { kind: "available"; latest: string; notes: string | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

interface Props {
  /** When true, run a check as soon as the component mounts. */
  autoStart?: boolean;
}

export function UpdateChecker({ autoStart = false }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const startedRef = useRef(false);

  const runCheck = async () => {
    setStatus({ kind: "checking" });
    try {
      const result = await invoke<UpdateCheckResult>("check_for_update");
      if (result.available && result.latestVersion) {
        setStatus({
          kind: "available",
          latest: result.latestVersion,
          notes: result.releaseNotes,
        });
      } else {
        setStatus({ kind: "up_to_date", current: result.currentVersion });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message });
    }
  };

  const runInstall = async () => {
    setStatus({ kind: "installing" });
    try {
      await invoke("install_update");
      // The app restarts after install — no need to update the UI.
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message });
    }
  };

  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void runCheck();
    }
  }, [autoStart]);

  const isBusy = status.kind === "checking" || status.kind === "installing";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t("updater.button")}</span>
        <button
          type="button"
          onClick={runCheck}
          disabled={isBusy}
          className="btn text-xs bg-slate-800 hover:bg-brand text-white px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-50"
        >
          {status.kind === "checking"
            ? t("updater.checking")
            : t("updater.button")}
        </button>
      </div>

      {status.kind === "up_to_date" && (
        <p className="text-xs text-slate-400">
          {t("updater.up_to_date", { version: status.current })}
        </p>
      )}

      {status.kind === "available" && (
        <div className="flex flex-col gap-2 mt-1 p-3 rounded-lg bg-slate-900 border border-slate-800">
          <p className="text-xs font-semibold text-success">
            {t("updater.available", { version: status.latest })}
          </p>
          {status.notes && (
            <pre className="text-[11px] text-slate-400 whitespace-pre-wrap font-sans max-h-24 overflow-y-auto">
              {status.notes}
            </pre>
          )}
          <button
            type="button"
            onClick={runInstall}
            className="btn bg-success hover:bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg self-start"
          >
            {t("updater.install")}
          </button>
        </div>
      )}

      {status.kind === "installing" && (
        <p className="text-xs text-brand">{t("updater.installing")}</p>
      )}

      {status.kind === "error" && (
        <p
          className={clsx("text-xs text-danger break-words")}
          title={status.message}
        >
          {t("updater.error", { msg: status.message.slice(0, 120) })}
        </p>
      )}
    </div>
  );
}
