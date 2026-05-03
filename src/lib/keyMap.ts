/**
 * Translates KeyboardEvent → Tauri global-shortcut format and back to a
 * human-readable label. Pure functions, no DOM access.
 *
 * Tauri global-shortcut format example: "Ctrl+Shift+PrintScreen"
 *   - modifiers separated by '+' in the order Ctrl, Alt, Shift, Meta
 *   - keys use PascalCase: A, 1, F5, PrintScreen, ArrowUp→Up, etc.
 */

type ModifierKey = "Ctrl" | "Alt" | "Shift" | "Meta";

const MODIFIER_KEY_NAMES = new Set([
  "Control",
  "Alt",
  "Shift",
  "Meta",
  "OS",
  "ContextMenu",
]);

const SPECIAL_CODE_MAP: Record<string, string> = {
  PrintScreen: "PrintScreen",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  CapsLock: "CapsLock",
  NumLock: "NumLock",
  ScrollLock: "ScrollLock",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
};

function codeToTauri(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (code.startsWith("Numpad")) {
    const rest = code.slice(6);
    if (/^\d$/.test(rest)) return `Num${rest}`;
  }
  return SPECIAL_CODE_MAP[code] ?? null;
}

export function eventToCombo(e: KeyboardEvent): string | null {
  if (MODIFIER_KEY_NAMES.has(e.key)) return null;

  const key = codeToTauri(e.code);
  if (!key) return null;

  const parts: ModifierKey[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  return [...parts, key].join("+");
}

function humanizeToken(token: string): string {
  return token.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function formatCombo(combo: string): string {
  return combo.split("+").map(humanizeToken).join(" + ");
}
