import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  isEnabled as autostartIsEnabled,
  enable as autostartEnable,
  disable as autostartDisable,
} from "@tauri-apps/plugin-autostart";
import { t } from "@/i18n";
import { LANGUAGES } from "@/i18n/languages";
import { UpdateChecker } from "@/components/UpdateChecker";
import type { AppConfig } from "@/lib/config";
import { Card, Row, Section, Switch } from "./ui";

interface Props {
  config: AppConfig;
  onConfig: (config: AppConfig) => void;
  autoCheckUpdates?: boolean;
  onUpdatesChecked?: () => void;
}

export function GeneralPage({
  config,
  onConfig,
  autoCheckUpdates,
  onUpdatesChecked,
}: Props) {
  const [startup, setStartup] = useState(false);

  useEffect(() => {
    void autostartIsEnabled().then(setStartup);
  }, []);

  // Runs after UpdateChecker's own mount effect, which has read the flag.
  useEffect(() => {
    if (autoCheckUpdates) onUpdatesChecked?.();
  }, [autoCheckUpdates, onUpdatesChecked]);

  const toggleStartup = async (enabled: boolean) => {
    await (enabled ? autostartEnable() : autostartDisable());
    setStartup(enabled);
  };

  const toggleNotify = async (enabled: boolean) => {
    onConfig({ ...config, notify_link: enabled });
    await invoke("save_notify_link", { enabled });
  };

  const changeLanguage = async (language: string) => {
    onConfig({ ...config, language });
    await invoke("set_language", { language });
  };

  return (
    <>
      <Section title={t("settings.general.app")}>
        <Card>
          <Row
            label={t("settings.general.startup")}
            hint={t("settings.general.startup_hint")}
          >
            <Switch
              label={t("settings.general.startup")}
              checked={startup}
              onChange={(v) => void toggleStartup(v)}
            />
          </Row>
          <Row
            label={t("settings.general.notify")}
            hint={t("settings.general.notify_hint")}
          >
            <Switch
              label={t("settings.general.notify")}
              checked={config.notify_link}
              onChange={(v) => void toggleNotify(v)}
            />
          </Row>
          <Row
            label={t("settings.general.language")}
            hint={t("settings.general.language_hint")}
            htmlFor="language"
          >
            <select
              id="language"
              value={config.language}
              onChange={(e) => void changeLanguage(e.target.value)}
              className="min-h-11 px-2.5 bg-slate-950 border border-slate-600 rounded-lg text-sm text-slate-50 cursor-pointer"
            >
              <option value="auto">{t("settings.general.language_auto")}</option>
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </Row>
        </Card>
      </Section>

      <Section title={t("settings.general.updates")}>
        <Card>
          <div className="px-4 py-3">
            <UpdateChecker autoStart={autoCheckUpdates} />
          </div>
        </Card>
      </Section>
    </>
  );
}
