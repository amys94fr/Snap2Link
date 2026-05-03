import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en as Record<string, string> } },
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
