import { describe, it, expect } from "vitest";
import { t } from "./index";
import en from "./locales/en.json";

describe("i18n.t", () => {
  it("returns the raw key when no translation exists", () => {
    expect(t("non.existent.key")).toBe("non.existent.key");
  });

  it("returns the translated string for a known key", () => {
    expect(t("wizard.welcome.btn")).toBe(en["wizard.welcome.btn"]);
  });

  it("preserves multiline strings (\\n)", () => {
    expect(t("wizard.welcome.subtitle")).toContain("\n");
  });

  it("interpolates {var} placeholders", () => {
    expect(t("about.version", { version: "1.0.0" })).toBe("Version 1.0.0");
  });

  it("interpolates multiple placeholders", () => {
    const out = t("notify.active.msg", { shortcut: "Ctrl + PrtSc" });
    expect(out).toBe("Shortcut: Ctrl + PrtSc  •  or click the icon");
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
