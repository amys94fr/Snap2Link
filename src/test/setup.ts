import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    setFocus: vi.fn(),
    close: vi.fn(),
  })),
  WebviewWindow: {
    getByLabel: vi.fn(async () => ({
      show: vi.fn(),
      hide: vi.fn(),
      setFocus: vi.fn(),
      setPosition: vi.fn(),
      center: vi.fn(),
    })),
  },
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => false),
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

// PNG/JPG imports via Vite return a URL string at runtime; Vitest doesn't
// resolve binary assets the same way, so we stub them.
vi.mock("@/assets/logo.png", () => ({ default: "/logo.png" }));
