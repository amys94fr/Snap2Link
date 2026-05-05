import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import * as autostart from "@tauri-apps/plugin-autostart";
import { SettingsWindow } from "./SettingsWindow";

const defaultConfig = {
  hotkey: "Ctrl+PrintScreen",
  retention_days: 30,
  auto_delete: true,
};

function mockInvoke(overrides?: {
  email?: string | null;
  config?: typeof defaultConfig;
}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_account_email") return overrides?.email ?? "user@example.com";
    if (cmd === "get_config") return overrides?.config ?? defaultConfig;
    return undefined;
  });
}

describe("<SettingsWindow />", () => {
  beforeEach(() => {
    mockInvoke();
    vi.mocked(autostart.isEnabled).mockResolvedValue(false);
  });

  it("loads and displays the account email and current hotkey", async () => {
    render(<SettingsWindow onClose={() => {}} onAbout={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("user@example.com")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent(
      "Ctrl + Print Screen",
    );
  });

  it("displays the Drive folder name", async () => {
    render(<SettingsWindow onClose={() => {}} onAbout={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Snap2Link")).toBeInTheDocument(),
    );
  });

  it("calls onClose when Close is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsWindow onClose={onClose} onAbout={() => {}} />);
    await waitFor(() =>
      screen.getByRole("button", { name: /^close$/i }),
    );
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onAbout when About is clicked", async () => {
    const onAbout = vi.fn();
    const user = userEvent.setup();
    render(<SettingsWindow onClose={() => {}} onAbout={onAbout} />);
    await waitFor(() =>
      screen.getByRole("button", { name: /^about$/i }),
    );
    await user.click(screen.getByRole("button", { name: /^about$/i }));
    expect(onAbout).toHaveBeenCalledTimes(1);
  });

  it("disconnects then re-authenticates when Switch Account is clicked", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_account_email") return "old@example.com";
      if (cmd === "get_config") return defaultConfig;
      if (cmd === "disconnect") return undefined;
      if (cmd === "authenticate") return "new@example.com";
      return undefined;
    });
    const user = userEvent.setup();
    render(<SettingsWindow onClose={() => {}} onAbout={() => {}} />);
    await waitFor(() => screen.getByText("old@example.com"));

    await user.click(screen.getByRole("button", { name: /switch account/i }));

    await waitFor(() => {
      expect(screen.getByText("new@example.com")).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith("disconnect");
    expect(invoke).toHaveBeenCalledWith("authenticate");
  });

  it("toggles auto-delete and persists via save_config", async () => {
    const user = userEvent.setup();
    render(<SettingsWindow onClose={() => {}} onAbout={() => {}} />);
    await waitFor(() => screen.getByRole("checkbox", { name: /auto-delete/i }));

    await user.click(screen.getByRole("checkbox", { name: /auto-delete/i }));

    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({ autoDelete: false }),
    );
  });

  it("persists a new retention via save_config when OK is clicked", async () => {
    const user = userEvent.setup();
    render(<SettingsWindow onClose={() => {}} onAbout={() => {}} />);
    await waitFor(() => screen.getByLabelText(/keep screenshots for/i));

    const input = screen.getByLabelText(/keep screenshots for/i);
    await user.clear(input);
    await user.type(input, "60");
    await user.click(screen.getByRole("button", { name: /^ok$/i }));

    expect(invoke).toHaveBeenCalledWith(
      "save_config",
      expect.objectContaining({ retentionDays: 60 }),
    );
  });

  it("persists hotkey changes via save_config and update_hotkey", async () => {
    const user = userEvent.setup();
    render(<SettingsWindow onClose={() => {}} onAbout={() => {}} />);
    await waitFor(() => screen.getByRole("button", { name: /edit/i }));
    await user.click(screen.getByRole("button", { name: /edit/i }));

    await user.keyboard("{Control>}q{/Control}");

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_config",
        expect.objectContaining({ hotkey: "Ctrl+Q" }),
      );
    });
    expect(invoke).toHaveBeenCalledWith("update_hotkey", { hotkey: "Ctrl+Q" });
  });

  it("toggles Start with Windows via plugin-autostart", async () => {
    const user = userEvent.setup();
    render(<SettingsWindow onClose={() => {}} onAbout={() => {}} />);
    await waitFor(() => screen.getByRole("checkbox", { name: /start with windows/i }));

    await user.click(
      screen.getByRole("checkbox", { name: /start with windows/i }),
    );
    expect(autostart.enable).toHaveBeenCalledTimes(1);
  });
});
