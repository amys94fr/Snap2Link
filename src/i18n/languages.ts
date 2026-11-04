/** Shipped languages, each in its own name so anyone can find theirs. */
export const LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "es", name: "Español" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "hi", name: "हिन्दी" },
  { code: "tr", name: "Türkçe" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "it", name: "Italiano" },
  { code: "pl", name: "Polski" },
  { code: "ar", name: "العربية" },
  { code: "he", name: "עברית" },
  { code: "fa", name: "فارسی" },
];

const RTL = new Set(["ar", "he", "fa"]);

export function isRtl(code: string): boolean {
  return RTL.has(code);
}
