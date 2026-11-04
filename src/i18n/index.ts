import { useSyncExternalStore } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isRtl } from "./languages";

const locales = import.meta.glob<Record<string, string>>("./locales/*.json", {
  eager: true,
  import: "default",
});

const resources = Object.fromEntries(
  Object.entries(locales).map(([path, translation]) => [
    path.replace(/^.*\/(.+)\.json$/, "$1"),
    { translation },
  ]),
);

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources,
  interpolation: {
    escapeValue: false,
    prefix: "{",
    suffix: "}",
  },
  keySeparator: false,
  nsSeparator: false,
  returnNull: false,
});

export default i18n;

export function t(
  key: string,
  vars?: Record<string, string | number>,
): string {
  return i18n.t(key, vars as never) as unknown as string;
}

export async function applyLanguage(code: string): Promise<void> {
  await i18n.changeLanguage(code);
  document.documentElement.lang = code;
  document.documentElement.dir = isRtl(code) ? "rtl" : "ltr";
}

/** Rust resolves the language ("auto" included), so the tray, the windows and
 *  the sign-in page always agree. */
export async function initLanguage(): Promise<void> {
  void listen<string>("language-changed", (e) => {
    void applyLanguage(e.payload);
  });
  try {
    const code = await invoke<string>("get_language");
    if (code) await applyLanguage(code);
  } catch {
    /* stays in English */
  }
}

function subscribe(onChange: () => void) {
  i18n.on("languageChanged", onChange);
  return () => i18n.off("languageChanged", onChange);
}

/** `t` isn't reactive: the root component calls this to re-render on change. */
export function useLanguage(): string {
  return useSyncExternalStore(subscribe, () => i18n.language);
}
