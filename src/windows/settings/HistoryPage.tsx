import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import i18n, { t } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import {
  BUTTON,
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  CameraIcon,
  Card,
  Row,
  Section,
} from "./ui";

interface Entry {
  id: string;
  url: string;
  thumbnail: string | null;
  created_at: string;
  expires_at: string | null;
  kept: boolean;
}

interface History {
  entries: Entry[];
  /** 0 when keeping a link means nothing on this host, null when there's no limit. */
  max_kept: number | null;
}

const COPIED_MS = 2000;
const HOUR_MS = 3_600_000;

const ACTION_ERRORS: Record<string, string> = {
  relay_pin_limit: "history.error.pin_limit",
  relay_unreachable: "uploader.error.unreachable",
};

function actionError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return t(ACTION_ERRORS[code] ?? "history.error.action");
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

/** "in 46 hours", in the app's language, or in days past two of them. */
function timeLeft(date: string, now: number): string {
  const hours = Math.max(1, Math.round((new Date(date).getTime() - now) / HOUR_MS));
  const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: "always" });
  return hours > 48 ? format.format(Math.round(hours / 24), "day") : format.format(hours, "hour");
}

function Thumbnail({ entry, label }: { entry: Entry; label: string }) {
  const [failed, setFailed] = useState(false);
  const box = "w-24 h-16 shrink-0 rounded-md bg-slate-950 border border-slate-800";

  if (!entry.thumbnail || failed) {
    return (
      <div className={`${box} flex items-center justify-center text-slate-400`}>
        <CameraIcon />
      </div>
    );
  }
  return (
    <img
      src={entry.thumbnail}
      alt={label}
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className={`${box} object-cover`}
    />
  );
}

export function HistoryPage() {
  const setCategory = useAppStore((state) => state.setCategory);
  const [history, setHistory] = useState<History | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setHistory(await invoke<History>("get_history"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => clearTimeout(copiedTimer.current);
  }, [load]);

  const copy = async (entry: Entry) => {
    setActionFailed(null);
    try {
      await writeText(entry.url);
      setCopied(entry.id);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
    } catch (e) {
      setActionFailed(actionError(e));
    }
  };

  /** A kept capture can change its end date, so the list comes back from the host. */
  const keep = async (entry: Entry) => {
    setBusy(entry.id);
    setActionFailed(null);
    try {
      await invoke("set_capture_kept", { id: entry.id, kept: !entry.kept });
      await load();
    } catch (e) {
      setActionFailed(actionError(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: Entry) => {
    if (confirming !== entry.id) {
      setConfirming(entry.id);
      return;
    }
    setBusy(entry.id);
    setConfirming(null);
    setActionFailed(null);
    try {
      await invoke("delete_capture", { id: entry.id });
      setHistory((list) =>
        list && { ...list, entries: list.entries.filter(({ id }) => id !== entry.id) },
      );
    } catch (e) {
      setActionFailed(actionError(e));
    } finally {
      setBusy(null);
    }
  };

  if (loadError === "drive_not_connected") {
    return (
      <Card>
        <Row label={t("history.drive_needed")}>
          <button type="button" className={BUTTON_PRIMARY} onClick={() => setCategory("hosting")}>
            {t("history.open_hosting")}
          </button>
        </Row>
      </Card>
    );
  }

  if (loadError !== null) {
    return (
      <Card>
        <Row label={<span role="alert">{t("history.error.load")}</span>}>
          <button type="button" className={BUTTON} onClick={() => void load()}>
            {t("history.retry")}
          </button>
        </Row>
      </Card>
    );
  }

  if (history === null) {
    return <div aria-busy="true" className="h-40 rounded-[10px] bg-slate-900" />;
  }

  const { entries, max_kept: maxKept } = history;
  if (entries.length === 0) {
    return (
      <Card>
        <Row label={t("history.empty")} />
      </Card>
    );
  }

  const canKeep = maxKept !== 0;
  const keptCount = entries.filter(({ kept }) => kept).length;
  const atLimit = maxKept !== null && keptCount >= maxKept;
  const now = Date.now();

  return (
    <Section>
      {canKeep && (
        <p className="text-[13px] text-slate-300">
          {maxKept !== null && `${t("history.kept_count", { kept: keptCount, max: maxKept })} · `}
          {t(maxKept === null ? "history.keep_hint_drive" : "history.keep_hint_relay")}
        </p>
      )}
      {actionFailed && (
        <p role="alert" className="text-[13px] text-red-300">
          {actionFailed}
        </p>
      )}
      <Card>
        <ul className="divide-y divide-slate-800">
          {entries.map((entry) => {
            const date = formatDate(entry.created_at);
            const pending = busy === entry.id;
            const asking = confirming === entry.id;
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3">
                <Thumbnail entry={entry} label={t("history.thumbnail", { date })} />
                <div className="flex-[1_1_140px] min-w-0">
                  <div className="text-sm font-semibold break-words">{date}</div>
                  <p className="mt-0.5 text-[13px] text-slate-300">
                    {entry.expires_at
                      ? t("history.ends", { when: timeLeft(entry.expires_at, now) })
                      : t("history.no_end")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label={`${t("history.copy")}, ${date}`}
                    onClick={() => void copy(entry)}
                  >
                    <span aria-live="polite">
                      {t(copied === entry.id ? "history.copied" : "history.copy")}
                    </span>
                  </button>
                  {canKeep && (
                    <button
                      type="button"
                      className={entry.kept ? BUTTON_PRIMARY : BUTTON}
                      aria-pressed={entry.kept}
                      aria-label={`${t("history.keep")}, ${date}`}
                      disabled={pending || (atLimit && !entry.kept)}
                      onClick={() => void keep(entry)}
                    >
                      {t(entry.kept ? "history.kept" : "history.keep")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={BUTTON_DANGER}
                    aria-label={`${t(asking ? "history.delete_confirm" : "history.delete")}, ${date}`}
                    disabled={pending}
                    onBlur={() => setConfirming(null)}
                    onClick={() => void remove(entry)}
                  >
                    {t(asking ? "history.delete_confirm" : "history.delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}
