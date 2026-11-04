import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { BUTTON, Row, Switch } from "@/windows/settings/ui";

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
    <>
      <Row
        label={t("settings.auto_delete")}
        hint={
          enabled
            ? t("settings.hosting.auto_delete_on")
            : t("settings.hosting.auto_delete_off")
        }
      >
        <Switch
          label={t("settings.auto_delete")}
          checked={enabled}
          onChange={onToggle}
        />
      </Row>

      {enabled && (
        <Row
          label={t("settings.keep_for")}
          hint={
            savedDays !== null ? (
              <span className="text-green-300">
                {t("settings.delete_saved", { days: savedDays })}
              </span>
            ) : (
              t("settings.hosting.keep_hint")
            )
          }
          htmlFor="retention-days"
        >
          <div className="flex items-center gap-2">
            <input
              id="retention-days"
              type="number"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-20 min-h-11 text-center bg-slate-950 border border-slate-600 rounded-lg text-sm"
            />
            <span className="text-[13px] text-slate-300">
              {t("settings.days")}
            </span>
            <button type="button" onClick={handleSave} className={BUTTON}>
              {t("settings.save")}
            </button>
          </div>
        </Row>
      )}
    </>
  );
}
