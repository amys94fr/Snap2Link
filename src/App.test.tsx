import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { useAppStore } from "./store/appStore";

const CONFIG = {
  hotkey: "Ctrl+PrintScreen",
  retention_days: 30,
  auto_delete: true,
  profiles: [{ hotkey: "Ctrl+PrintScreen", mode: "ask", after: "ask" }],
  last_choice: {},
  language: "auto",
  notify_link: true,
  hosting: "snap2link",
};

beforeEach(() => {
  useAppStore.setState({
    page: "wizard",
    category: "capture",
    setupDone: false,
  });
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "is_first_run") return true;
    if (cmd === "get_account_email") return "user@example.com";
    if (cmd === "get_config") {
      return CONFIG;
    }
    return undefined;
  });
});

describe("<App /> routing", () => {
  it("renders the SetupWizard on the first run", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_first_run") return true;
      return undefined;
    });
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /start without an account/i }),
      ).toBeInTheDocument(),
    );
  });

  it("renders the SettingsWindow once set up", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_first_run") return false;
      if (cmd === "get_account_email") return "user@example.com";
      if (cmd === "get_config") {
        return CONFIG;
      }
      return undefined;
    });
    useAppStore.setState({ page: "settings", setupDone: true });

    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /^capture$/i }),
      ).toBeInTheDocument(),
    );
  });

  it("opens the About category when the tray asks for it", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_first_run") return false;
      if (cmd === "get_config") return CONFIG;
      return undefined;
    });
    useAppStore.getState().setSetupDone(true);
    useAppStore.getState().setPage("about");

    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /snap2link/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/^version \d+\.\d+\.\d+$/i)).toBeInTheDocument();
  });
});
