import { useEffect, useState } from "react";
import { eventToCombo, formatCombo } from "@/lib/keyMap";
import { t } from "@/i18n";
import clsx from "clsx";

interface Props {
  current: string;
  /** Resolves to false when the combination was refused: the parent shows why. */
  onChange: (combo: string) => void | Promise<boolean | void>;
  onCancel?: () => void;
  /** Starts listening right away, for a shortcut that doesn't exist yet. */
  autoStart?: boolean;
}

type Hint = { kind: "info" | "success"; text: string };

const recordingHint = (): Hint => ({
  kind: "info",
  text: t("settings.shortcut.recording"),
});

export function HotkeyRecorder({
  current,
  onChange,
  onCancel,
  autoStart = false,
}: Props) {
  const [recording, setRecording] = useState(autoStart);
  const [hint, setHint] = useState<Hint | null>(
    autoStart ? recordingHint() : null,
  );

  useEffect(() => {
    if (!recording) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (
        e.key === "Escape" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.metaKey
      ) {
        setRecording(false);
        setHint(null);
        onCancel?.();
        return;
      }

      const combo = eventToCombo(e);
      if (!combo) return;

      setRecording(false);
      setHint(null);
      void Promise.resolve(onChange(combo)).then((accepted) => {
        if (accepted === false) {
          // Nothing to fall back on yet: stay ready, Cancel remains available.
          if (autoStart) {
            setRecording(true);
            setHint(recordingHint());
          }
          return;
        }
        setHint({ kind: "success", text: t("settings.shortcut.saved") });
        window.setTimeout(() => setHint(null), 3000);
      });
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [recording, onChange, onCancel, autoStart]);

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      setHint(null);
      onCancel?.();
    } else {
      setRecording(true);
      setHint(recordingHint());
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          data-testid="hotkey-display"
          dir="ltr"
          className="font-mono text-[13px] tabular-nums"
        >
          {recording ? "…" : formatCombo(current)}
        </span>
        <button
          type="button"
          onClick={toggleRecording}
          className={clsx(
            "btn min-h-11 px-3.5 text-[13px] text-white whitespace-nowrap",
            recording
              ? "bg-brand"
              : "bg-slate-800 hover:bg-slate-700 border border-slate-600",
          )}
        >
          {recording
            ? t("settings.shortcut.cancel")
            : t("settings.shortcut.edit")}
        </button>
      </div>
      {hint && (
        <p
          className={clsx(
            "text-xs mt-1",
            hint.kind === "success" ? "text-green-300" : "text-blue-300",
          )}
        >
          {hint.text}
        </p>
      )}
    </div>
  );
}
