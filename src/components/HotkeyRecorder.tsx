import { useEffect, useState } from "react";
import { eventToCombo, formatCombo } from "@/lib/keyMap";
import { t } from "@/i18n";
import clsx from "clsx";

interface Props {
  current: string;
  onChange: (combo: string) => void;
  onCancel?: () => void;
}

type Hint = { kind: "info" | "success"; text: string };

export function HotkeyRecorder({ current, onChange, onCancel }: Props) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);

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
      setHint({ kind: "success", text: t("settings.shortcut.saved") });
      onChange(combo);

      const id = window.setTimeout(() => setHint(null), 3000);
      return () => window.clearTimeout(id);
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [recording, onChange, onCancel]);

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      setHint(null);
      onCancel?.();
    } else {
      setRecording(true);
      setHint({ kind: "info", text: t("settings.shortcut.recording") });
    }
  };

  return (
    <div className="mt-1 mb-3">
      <div className="flex items-center gap-3">
        <span
          data-testid="hotkey-display"
          className="font-bold text-sm tabular-nums min-w-[140px]"
        >
          {recording ? "…" : formatCombo(current)}
        </span>
        <button
          type="button"
          onClick={toggleRecording}
          className={clsx(
            "btn text-xs px-3 py-1.5 rounded-lg",
            recording
              ? "bg-brand text-white"
              : "bg-slate-800 hover:bg-brand text-white",
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
            hint.kind === "success" ? "text-success" : "text-brand",
          )}
        >
          {hint.text}
        </p>
      )}
    </div>
  );
}
