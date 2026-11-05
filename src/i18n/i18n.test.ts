import { afterEach, describe, it, expect } from "vitest";
import { applyLanguage, t } from "./index";
import { LANGUAGES, isRtl } from "./languages";
import en from "./locales/en.json";

const locales = import.meta.glob<Record<string, string>>("./locales/*.json", {
  eager: true,
  import: "default",
});

function locale(code: string): Record<string, string> {
  return locales[`./locales/${code}.json`];
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("locale files", () => {
  it("ship exactly the listed languages", () => {
    const files = Object.keys(locales).map((p) =>
      p.replace(/^.*\/(.+)\.json$/, "$1"),
    );
    expect(files.sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  it.each(LANGUAGES.map((l) => l.code))("%s has every key", (code) => {
    expect(Object.keys(locale(code)).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(LANGUAGES.map((l) => l.code))(
    "%s keeps placeholders and fills every string",
    (code) => {
      for (const [key, value] of Object.entries(en)) {
        const translated = locale(code)[key];
        expect(translated.trim(), `${code}: ${key}`).not.toBe("");
        expect(placeholders(translated), `${code}: ${key}`).toEqual(
          placeholders(value),
        );
      }
    },
  );

  it.each(LANGUAGES.map((l) => l.code))("%s has no em dash", (code) => {
    for (const [key, value] of Object.entries(locale(code))) {
      expect(value.includes("\u2014"), `${code}: ${key}`).toBe(false);
    }
  });
});

describe("applyLanguage", () => {
  afterEach(() => applyLanguage("en"));

  it("switches the strings and the document language", async () => {
    await applyLanguage("fr");
    expect(t("settings.nav.hosting")).toBe(locale("fr")["settings.nav.hosting"]);
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it.each(["ar", "he", "fa"])("lays %s out right to left", async (code) => {
    expect(isRtl(code)).toBe(true);
    await applyLanguage(code);
    expect(document.documentElement.dir).toBe("rtl");
  });
});

describe("i18n.t", () => {
  it("returns the raw key when no translation exists", () => {
    expect(t("non.existent.key")).toBe("non.existent.key");
  });

  it("returns the translated string for a known key", () => {
    expect(t("wizard.welcome.drive")).toBe(en["wizard.welcome.drive"]);
  });

  it("preserves multiline strings (\\n)", () => {
    expect(t("wizard.welcome.subtitle")).toContain("\n");
  });

  it("interpolates {var} placeholders", () => {
    expect(t("about.version", { version: "1.0.0" })).toBe("Version 1.0.0");
  });

  it("interpolates multiple placeholders", () => {
    const out = t("settings.capture.shortcuts", { count: 2, max: 3 });
    expect(out).toBe("Capture shortcuts (2 of 3)");
  });

  it("does not crash if interpolation variable is missing", () => {
    const out = t("about.version");
    expect(typeof out).toBe("string");
  });

  it("interpolates numbers cleanly (no '0' fallback) for tray.about", () => {
    expect(t("tray.about", { version: "1.0.0" })).toBe(
      "About Snap2Link  •  v1.0.0",
    );
  });
});
