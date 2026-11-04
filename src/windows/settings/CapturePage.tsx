import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "@/i18n";
import { HotkeyRecorder } from "@/components/HotkeyRecorder";
import { formatCombo } from "@/lib/keyMap";
import {
  MAX_PROFILES,
  type AppConfig,
  type CaptureProfile,
  type LastChoice,
  type ProfileAfter,
  type ProfileMode,
} from "@/lib/config";
import {
  BUTTON,
  BUTTON_DANGER,
  Card,
  ChevronIcon,
  KEY,
  PlusIcon,
  Row,
  Section,
  Segmented,
  WarningIcon,
} from "./ui";

const MODES: ProfileMode[] = ["ask", "region", "full_screen", "active_window"];
const AFTERS: ProfileAfter[] = ["ask", "share", "annotate"];

const KNOWN_ERRORS = new Set([
  "duplicate_hotkey",
  "hotkey_unavailable",
  "invalid_hotkey",
]);

function errorText(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  return KNOWN_ERRORS.has(code)
    ? t(`settings.capture.error.${code}`)
    : t("settings.capture.error.generic", { msg: code.slice(0, 120) });
}

function rememberedChoice(last: LastChoice): string | null {
  const parts: string[] = [];
  if (last.mode === "region") parts.push(t("overlay.mode.region"));
  if (last.mode === "fullScreen") parts.push(t("overlay.mode.fullscreen"));
  if (last.mode === "window") parts.push(t("overlay.mode.window"));
  if (last.after === "edit") parts.push(t("overlay.prompt.edit"));
  if (last.after === "save") parts.push(t("overlay.prompt.save"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

interface Props {
  config: AppConfig;
  onConfig: (config: AppConfig) => void;
}

export function CapturePage({ config, onConfig }: Props) {
  const [open, setOpen] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { profiles } = config;

  useEffect(() => {
    const off = listen<LastChoice>("last-choice-changed", (e) => {
      onConfig({ ...config, last_choice: e.payload });
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, [config, onConfig]);

  const save = async (next: CaptureProfile[]): Promise<boolean> => {
    setError(null);
    try {
      await invoke("save_profiles", { profiles: next });
      onConfig({ ...config, profiles: next, hotkey: next[0].hotkey });
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  };

  const patch = (index: number, change: Partial<CaptureProfile>) =>
    save(profiles.map((p, i) => (i === index ? { ...p, ...change } : p)));

  const remove = async (index: number) => {
    if (await save(profiles.filter((_, i) => i !== index))) setOpen(0);
  };

  const add = async (hotkey: string) => {
    const ok = await save([...profiles, { hotkey, mode: "ask", after: "ask" }]);
    if (ok) {
      setAdding(false);
      setOpen(profiles.length);
    }
    return ok;
  };

  const resetMemory = async () => {
    await invoke("reset_last_choice");
    onConfig({ ...config, last_choice: {} });
  };

  const memory = rememberedChoice(config.last_choice);

  return (
    <>
      <Section
        title={t("settings.capture.shortcuts", {
          count: profiles.length,
          max: MAX_PROFILES,
        })}
      >
        {profiles.map((profile, index) => {
          const isOpen = open === index;
          const isDirect = profile.after === "share";
          return (
            <div
              key={profile.hotkey}
              data-testid={`profile-${index}`}
              className="bg-slate-900 border border-slate-800 rounded-[10px]"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? -1 : index)}
                className="w-full min-h-[60px] flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-start cursor-pointer rounded-[10px]"
              >
                <kbd dir="ltr" className={KEY}>
                  {formatCombo(profile.hotkey)}
                </kbd>
                <span className="flex-[1_1_160px] min-w-0 text-[13px] text-slate-300">
                  {t(`settings.mode.${profile.mode}`)} ·{" "}
                  {t(`settings.after.${profile.after}`)}
                </span>
                {isDirect && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <WarningIcon size={14} />
                    {t("settings.capture.no_confirm")}
                  </span>
                )}
                <ChevronIcon open={isOpen} />
              </button>

              {isOpen && (
                <div className="border-t border-slate-800 divide-y divide-slate-800">
                  <Row
                    label={t("settings.capture.what")}
                    hint={t(`settings.mode.${profile.mode}.help`)}
                  >
                    <Segmented
                      label={t("settings.capture.what")}
                      value={profile.mode}
                      onChange={(mode) => void patch(index, { mode })}
                      options={MODES.map((id) => ({
                        id,
                        label: t(`settings.mode.${id}`),
                      }))}
                    />
                  </Row>
                  <Row
                    label={t("settings.capture.after")}
                    hint={t(`settings.after.${profile.after}.help`)}
                  >
                    <Segmented
                      label={t("settings.capture.after")}
                      value={profile.after}
                      onChange={(after) => void patch(index, { after })}
                      options={AFTERS.map((id) => ({
                        id,
                        label: t(`settings.after.${id}`),
                      }))}
                    />
                  </Row>
                  {isDirect && (
                    <div className="p-3">
                      <p className="flex gap-2.5 p-3 bg-amber-950 border border-amber-700 rounded-lg text-[13px] text-amber-100">
                        <WarningIcon />
                        <span>{t("settings.after.share.warning")}</span>
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <HotkeyRecorder
                      current={profile.hotkey}
                      onChange={(hotkey) => patch(index, { hotkey })}
                    />
                    {profiles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => void remove(index)}
                        className={BUTTON_DANGER}
                      >
                        {t("settings.capture.delete")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {adding && (
          <Card>
            <Row label={t("settings.capture.new")}>
              <HotkeyRecorder
                current=""
                autoStart
                onChange={add}
                onCancel={() => setAdding(false)}
              />
            </Row>
          </Card>
        )}

        {!adding && profiles.length < MAX_PROFILES && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn min-h-11 gap-2 text-sm border border-dashed border-slate-500 text-slate-200 hover:border-slate-300 rounded-[10px]"
          >
            <PlusIcon />
            {t("settings.capture.add")}
          </button>
        )}

        {error && (
          <p role="alert" className="text-[13px] text-red-300">
            {error}
          </p>
        )}
      </Section>

      <Section title={t("settings.memory.title")}>
        <Card>
          <Row
            label={
              memory
                ? t("settings.memory.value", { choice: memory })
                : t("settings.memory.none")
            }
            hint={t("settings.memory.desc")}
          >
            <button
              type="button"
              onClick={() => void resetMemory()}
              disabled={!memory}
              className={BUTTON}
            >
              {t("settings.memory.reset")}
            </button>
          </Row>
        </Card>
      </Section>
    </>
  );
}
