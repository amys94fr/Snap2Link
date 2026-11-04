import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { t } from "@/i18n";
import type { AppConfig } from "@/lib/config";
import { useAppStore, type SettingsCategory } from "@/store/appStore";
import logoUrl from "@/assets/logo.png";
import { AboutWindow } from "./AboutWindow";
import { CapturePage } from "./settings/CapturePage";
import { GeneralPage } from "./settings/GeneralPage";
import { HostingPage } from "./settings/HostingPage";
import {
  CameraIcon,
  CheckIcon,
  CloudIcon,
  InfoIcon,
  SlidersIcon,
} from "./settings/ui";

interface Props {
  /** Runs an update check as soon as the General page opens (tray entry). */
  autoCheckUpdates?: boolean;
  onUpdatesChecked?: () => void;
}

const CATEGORIES: ReadonlyArray<{
  id: SettingsCategory;
  icon: ReactNode;
  descKey: string;
}> = [
  { id: "capture", icon: <CameraIcon />, descKey: "settings.capture.desc" },
  { id: "hosting", icon: <CloudIcon />, descKey: "settings.hosting.desc" },
  { id: "general", icon: <SlidersIcon />, descKey: "settings.general.desc" },
  { id: "about", icon: <InfoIcon />, descKey: "settings.about.desc" },
];

export function SettingsWindow({
  autoCheckUpdates,
  onUpdatesChecked,
}: Props) {
  const { category, setCategory } = useAppStore();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    void invoke<string | null>("get_account_email").then((e) =>
      setEmail(e ?? ""),
    );
    void invoke<AppConfig>("get_config").then(setConfig);
  }, []);

  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
  const onDrive = config?.hosting === "drive";

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 text-sm">
      <nav
        aria-label={t("settings.categories")}
        className="w-56 shrink-0 flex flex-col gap-1 px-3 py-5 border-e border-slate-800"
      >
        <div className="flex items-center gap-2.5 px-2.5 pb-4">
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className="size-8 select-none"
            draggable={false}
          />
          <span className="text-base font-bold">{t("settings.heading")}</span>
        </div>

        {CATEGORIES.map((item) => {
          const active = item.id === current.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setCategory(item.id)}
              className={clsx(
                "min-h-11 flex items-center gap-2.5 px-3 rounded-lg font-semibold text-start cursor-pointer",
                active
                  ? "bg-brand text-white"
                  : "text-slate-200 hover:bg-slate-900",
              )}
            >
              {item.icon}
              {t(`settings.nav.${item.id}`)}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCategory("hosting")}
          className="mt-auto flex flex-col gap-0.5 px-3 py-2.5 text-start bg-slate-900 border border-slate-800 rounded-lg cursor-pointer"
        >
          <span className="text-xs text-slate-300">
            {t("settings.active_host")}
          </span>
          <span className="font-semibold">
            {t(onDrive ? "settings.host.drive" : "settings.host.snap2link")}
          </span>
          {onDrive && email ? (
            <span dir="ltr" className="text-xs text-slate-300 truncate text-start">
              {email}
            </span>
          ) : (
            <span className="text-xs text-slate-300">
              {t(onDrive ? "settings.host.not_connected" : "settings.host.no_account")}
            </span>
          )}
        </button>
      </nav>

      <main className="flex-1 min-w-0 overflow-y-auto p-7 flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="flex-[1_1_320px] min-w-0">
            <h1 className="text-[22px] font-bold">
              {t(`settings.nav.${current.id}`)}
            </h1>
            <p className="mt-1 text-slate-300">{t(current.descKey)}</p>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-300">
            <CheckIcon />
            {t("settings.saved")}
          </p>
        </header>

        {config === null ? (
          <div aria-busy="true" className="h-40 rounded-[10px] bg-slate-900" />
        ) : (
          <>
            {current.id === "capture" && (
              <CapturePage config={config} onConfig={setConfig} />
            )}
            {current.id === "hosting" && (
              <HostingPage
                config={config}
                onConfig={setConfig}
                email={email}
                onEmail={setEmail}
              />
            )}
            {current.id === "general" && (
              <GeneralPage
                config={config}
                onConfig={setConfig}
                autoCheckUpdates={autoCheckUpdates}
                onUpdatesChecked={onUpdatesChecked}
              />
            )}
            {current.id === "about" && <AboutWindow />}
          </>
        )}
      </main>
    </div>
  );
}
