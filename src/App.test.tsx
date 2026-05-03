import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { useAppStore } from "./store/appStore";

beforeEach(() => {
  useAppStore.setState({ page: "wizard", isAuthenticated: false });
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "is_authenticated") return false;
    if (cmd === "get_account_email") return "user@example.com";
    if (cmd === "get_config") {
      return { hotkey: "Ctrl+PrintScreen", retention_days: 30, auto_delete: true };
    }
    return undefined;
  });
});

describe("<App /> routing", () => {
  it("renders the SetupWizard when not authenticated", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_authenticated") return false;
      return undefined;
    });
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /get started/i }),
      ).toBeInTheDocument(),
    );
  });

  it("renders the SettingsWindow when authenticated and page=settings", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_authenticated") return true;
      if (cmd === "get_account_email") return "user@example.com";
      if (cmd === "get_config") {
        return { hotkey: "Ctrl+PrintScreen", retention_days: 30, auto_delete: true };
      }
      return undefined;
    });
    useAppStore.setState({ page: "settings", isAuthenticated: true });

    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /^settings$/i }),
      ).toBeInTheDocument(),
    );
  });

  it("renders the AboutWindow when authenticated and page=about", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "is_authenticated") return true;
      return undefined;
    });
    useAppStore.setState({ page: "about", isAuthenticated: true });

    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /snap2link/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/version 1\.0\.0/i)).toBeInTheDocument();
  });
});
