import { describe, it, expect } from "vitest";
import { eventToCombo, formatCombo } from "./keyMap";

function ev(
  init: Partial<KeyboardEvent> & { code: string; key: string },
): KeyboardEvent {
  return {
    code: init.code,
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
  } as KeyboardEvent;
}

describe("eventToCombo", () => {
  it("returns Ctrl+S for ctrl + KeyS", () => {
    expect(eventToCombo(ev({ code: "KeyS", key: "s", ctrlKey: true }))).toBe(
      "Ctrl+S",
    );
  });

  it("returns Ctrl+PrintScreen for ctrl + PrintScreen", () => {
    expect(
      eventToCombo(ev({ code: "PrintScreen", key: "PrintScreen", ctrlKey: true })),
    ).toBe("Ctrl+PrintScreen");
  });

  it("preserves modifier order: Ctrl+Alt+Shift+Meta", () => {
    expect(
      eventToCombo(
        ev({
          code: "KeyA",
          key: "a",
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
          metaKey: true,
        }),
      ),
    ).toBe("Ctrl+Alt+Shift+Meta+A");
  });

  it("converts KeyA→A, Digit1→1, F5 unchanged", () => {
    expect(eventToCombo(ev({ code: "KeyA", key: "a", ctrlKey: true }))).toBe(
      "Ctrl+A",
    );
    expect(eventToCombo(ev({ code: "Digit1", key: "1", ctrlKey: true }))).toBe(
      "Ctrl+1",
    );
    expect(eventToCombo(ev({ code: "F5", key: "F5" }))).toBe("F5");
  });

  it("maps ArrowUp→Up, Escape→Escape, Space→Space", () => {
    expect(eventToCombo(ev({ code: "ArrowUp", key: "ArrowUp", ctrlKey: true }))).toBe(
      "Ctrl+Up",
    );
    expect(
      eventToCombo(ev({ code: "Space", key: " ", ctrlKey: true })),
    ).toBe("Ctrl+Space");
  });

  it("returns null when only a modifier is pressed", () => {
    expect(
      eventToCombo(ev({ code: "ControlLeft", key: "Control", ctrlKey: true })),
    ).toBeNull();
    expect(
      eventToCombo(ev({ code: "AltLeft", key: "Alt", altKey: true })),
    ).toBeNull();
    expect(
      eventToCombo(ev({ code: "ShiftRight", key: "Shift", shiftKey: true })),
    ).toBeNull();
    expect(
      eventToCombo(ev({ code: "MetaLeft", key: "Meta", metaKey: true })),
    ).toBeNull();
  });

  it("returns null for unknown codes", () => {
    expect(eventToCombo(ev({ code: "WeirdKey", key: "x" }))).toBeNull();
  });

  it("allows F1-F12 without any modifier (e.g. for media-key style hotkeys)", () => {
    expect(eventToCombo(ev({ code: "F12", key: "F12" }))).toBe("F12");
  });
});

describe("formatCombo (human display)", () => {
  it("splits camelCase tokens with spaces around +", () => {
    expect(formatCombo("Ctrl+PrintScreen")).toBe("Ctrl + Print Screen");
  });

  it("keeps short tokens intact", () => {
    expect(formatCombo("Ctrl+S")).toBe("Ctrl + S");
  });

  it("handles many modifiers", () => {
    expect(formatCombo("Ctrl+Alt+Shift+A")).toBe("Ctrl + Alt + Shift + A");
  });

  it("formats PageUp/PageDown nicely", () => {
    expect(formatCombo("Ctrl+PageUp")).toBe("Ctrl + Page Up");
    expect(formatCombo("Alt+PageDown")).toBe("Alt + Page Down");
  });
});
