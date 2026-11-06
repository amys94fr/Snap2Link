import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { t } from "@/i18n";
import { RetentionControl } from "@/components/RetentionControl";
import { AccountSection } from "./AccountSection";
import type { AppConfig, Hosting } from "@/lib/config";
import {
  BUTTON,
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  Card,
  CheckIcon,
  Row,
  Section,
} from "./ui";

const DRIVE_FOLDER_NAME = "Snap2Link";

interface Props {
  config: AppConfig;
  onConfig: (config: AppConfig) => void;
  /** Empty when no Google account is connected. */
  email: string;
  onEmail: (email: string) => void;
  /** The Snap2Link account's address, empty when signed out. */
  snapEmail: string;
  /** Called with the Snap2Link account's address, empty when signed out. */
  onSnapEmail: (email: string) => void;
}

function HostCard({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        "min-h-[88px] flex gap-3 p-3.5 text-start rounded-[10px] border-2 cursor-pointer",
        selected
          ? "bg-blue-950 border-blue-300"
          : "bg-slate-900 border-slate-800 hover:border-slate-500",
      )}
    >
      <span className="flex-1 min-w-0">
        <span className="block font-bold">{title}</span>
        <span className="block mt-0.5 text-[13px] text-slate-300">
          {description}
        </span>
      </span>
      {selected && (
        <span className="text-blue-300">
          <CheckIcon />
        </span>
      )}
    </button>
  );
}

function Snap2LinkOptions({ snapEmail, onSnapEmail }: Pick<Props, "snapEmail" | "onSnapEmail">) {
  return (
    <>
      <AccountSection onEmail={onSnapEmail} />
      <Section title={t("settings.hosting.access")}>
        <Card>
          <Row
            label={t(snapEmail ? "settings.hosting.link_life_account" : "settings.hosting.link_life")}
            hint={t("settings.hosting.link_life_hint")}
          />
          <Row label={t("settings.hosting.access_title")} />
        </Card>
      </Section>
    </>
  );
}

function DriveOptions({ config, onConfig, email, onEmail }: Props) {
  const [hint, setHint] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (replacing: boolean) => {
    setBusy(true);
    setHint({ kind: "info", text: t("settings.switch_account.loading") });
    try {
      if (replacing) await invoke("disconnect");
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
      setBusy(false);
    }
  };

  const signOut = async () => {
    await invoke("disconnect");
    onEmail("");
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
          {email ? (
            <Row
              label={<span dir="ltr">{email}</span>}
              hint={t("settings.hosting.account_hint")}
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void signIn(true)}
                  disabled={busy}
                  className={BUTTON}
                >
                  {t("settings.switch_account")}
                </button>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={busy}
                  className={BUTTON_DANGER}
                >
                  {t("settings.hosting.disconnect")}
                </button>
              </div>
            </Row>
          ) : (
            <Row
              label={t("settings.host.not_connected")}
              hint={t("settings.hosting.connect_hint")}
            >
              <button
                type="button"
                onClick={() => void signIn(false)}
                disabled={busy}
                className={BUTTON_PRIMARY}
              >
                {t("settings.hosting.connect")}
              </button>
            </Row>
          )}
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

export function HostingPage(props: Props) {
  const { config, onConfig } = props;

  const choose = async (hosting: Hosting) => {
    onConfig({ ...config, hosting });
    await invoke("set_hosting", { hosting });
  };

  return (
    <>
      <Section title={t("settings.hosting.choose")}>
        <div
          role="group"
          aria-label={t("settings.hosting.choose")}
          className="grid grid-cols-2 gap-2.5"
        >
          <HostCard
            title={t("settings.host.snap2link")}
            description={t("settings.hosting.snap2link_card")}
            selected={config.hosting === "snap2link"}
            onSelect={() => void choose("snap2link")}
          />
          <HostCard
            title={t("settings.host.drive")}
            description={t("settings.hosting.drive_card")}
            selected={config.hosting === "drive"}
            onSelect={() => void choose("drive")}
          />
        </div>
      </Section>

      {config.hosting === "drive" ? (
        <DriveOptions {...props} />
      ) : (
        <Snap2LinkOptions snapEmail={props.snapEmail} onSnapEmail={props.onSnapEmail} />
      )}
    </>
  );
}
