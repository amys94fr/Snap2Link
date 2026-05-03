import { useEffect, useState } from "react";
import { t } from "@/i18n";

interface Props {
  days: number;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onSave: (days: number) => void;
}

const MIN_DAYS = 1;
const MAX_DAYS = 3650;

function clamp(n: number): number {
  if (Number.isNaN(n)) return MIN_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.trunc(n)));
}

export function RetentionControl({ days, enabled, onToggle, onSave }: Props) {
  const [draft, setDraft] = useState(String(days));
  const [savedDays, setSavedDays] = useState<number | null>(null);

  useEffect(() => {
    setDraft(String(days));
  }, [days]);

  useEffect(() => {
    if (savedDays === null) return;
    const id = window.setTimeout(() => setSavedDays(null), 3000);
    return () => window.clearTimeout(id);
  }, [savedDays]);

  const handleSave = () => {
    const n = clamp(Number(draft));
    setDraft(String(n));
    setSavedDays(n);
    onSave(n);
  };

  return (
    <div className="mt-2">
      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm font-medium">{t("settings.auto_delete")}</span>
        <input
          type="checkbox"
          aria-label={t("settings.auto_delete")}
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-10 h-5 accent-brand cursor-pointer"
        />
      </label>

      <div className="flex items-center gap-2 mt-2">
        <label htmlFor="retention-days" className="text-xs text-slate-400">
          {t("settings.keep_for")}
        </label>
        <input
          id="retention-days"
          type="number"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={draft}
          disabled={!enabled}
          onChange={(e) => setDraft(e.target.value)}
          className="w-16 text-center bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-sm disabled:opacity-40"
        />
        <span className="text-xs text-slate-400">{t("settings.days")}</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!enabled}
          className="text-xs bg-slate-800 hover:bg-brand text-white px-3 py-1 rounded disabled:opacity-40"
        >
          OK
        </button>
      </div>
      {savedDays !== null && (
        <p className="text-xs text-success mt-1">
          {t("settings.delete_saved", { days: savedDays })}
        </p>
      )}
    </div>
  );
}
