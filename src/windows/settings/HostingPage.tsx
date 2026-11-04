import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { t } from "@/i18n";
import { RetentionControl } from "@/components/RetentionControl";
import type { AppConfig } from "@/lib/config";
import { BUTTON, BUTTON_DANGER, Card, Row, Section } from "./ui";

const DRIVE_FOLDER_NAME = "Snap2Link";

interface Props {
  config: AppConfig;
  onConfig: (config: AppConfig) => void;
  email: string;
  onEmail: (email: string) => void;
  onSignedOut: () => void;
}

export function HostingPage({
  config,
  onConfig,
  email,
  onEmail,
  onSignedOut,
}: Props) {
  const [hint, setHint] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [switching, setSwitching] = useState(false);

  const switchAccount = async () => {
    setSwitching(true);
    setHint({ kind: "info", text: t("settings.switch_account.loading") });
    try {
      await invoke("disconnect");
      const mail = await invoke<string>("authenticate");
      onEmail(mail);
      setHint({
        kind: "success",
        text: t("settings.switch_account.success", { email: mail }),
      });
      window.setTimeout(() => setHint(null), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setHint({
        kind: "error",
        text: t("settings.switch_account.error", { msg: msg.slice(0, 70) }),
      });
    } finally {
      setSwitching(false);
    }
  };

  const signOut = async () => {
    await invoke("disconnect");
    onSignedOut();
  };

  const saveRetention = async (retention_days: number, auto_delete: boolean) => {
    onConfig({ ...config, retention_days, auto_delete });
    await invoke("save_config", {
      retentionDays: retention_days,
      autoDelete: auto_delete,
    });
  };

  const openDrive = () => {
    const url = config.folder_id
      ? `https://drive.google.com/drive/folders/${config.folder_id}`
      : "https://drive.google.com/";
    void openUrl(url);
  };

  return (
    <>
      <Section title={t("settings.hosting.account")}>
        <Card>
          <Row
            label={<span dir="ltr">{email}</span>}
            hint={t("settings.hosting.account_hint")}
          >
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void switchAccount()}
                disabled={switching}
                className={BUTTON}
              >
                {t("settings.switch_account")}
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={switching}
                className={BUTTON_DANGER}
              >
                {t("settings.hosting.disconnect")}
              </button>
            </div>
          </Row>
        </Card>
        {hint && (
          <p
            role="status"
            className={clsx(
              "text-[13px]",
              hint.kind === "success" && "text-green-300",
              hint.kind === "error" && "text-red-300",
              hint.kind === "info" && "text-slate-300",
            )}
          >
            {hint.text}
          </p>
        )}
      </Section>

      <Section title={t("settings.hosting.storage")}>
        <Card>
          <Row
            label={t("settings.hosting.folder", { name: DRIVE_FOLDER_NAME })}
            hint={t("settings.hosting.folder_hint")}
          >
            <button type="button" onClick={openDrive} className={BUTTON}>
              {t("settings.hosting.open_drive")}
            </button>
          </Row>
          <RetentionControl
            days={config.retention_days}
            enabled={config.auto_delete}
            onToggle={(enabled) =>
              void saveRetention(config.retention_days, enabled)
            }
            onSave={(days) => void saveRetention(days, config.auto_delete)}
          />
        </Card>
      </Section>

      <Section title={t("settings.hosting.access")}>
        <Card>
          <Row
            label={t("settings.hosting.access_title")}
            hint={t("settings.hosting.access_hint")}
          />
        </Card>
      </Section>
    </>
  );
}
