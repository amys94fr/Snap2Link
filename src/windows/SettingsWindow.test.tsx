import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import * as autostart from "@tauri-apps/plugin-autostart";
import { SettingsWindow } from "./SettingsWindow";
import { useAppStore, type SettingsCategory } from "@/store/appStore";
import type { AppConfig } from "@/lib/config";

const defaultConfig: AppConfig = {
  hotkey: "Ctrl+PrintScreen",
  retention_days: 30,
  auto_delete: true,
  profiles: [{ hotkey: "Ctrl+PrintScreen", mode: "ask", after: "ask" }],
  last_choice: {},
  language: "auto",
  notify_link: true,
  hosting: "drive",
};

function mockInvoke(config: Partial<AppConfig> = {}, email = "user@example.com") {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_account_email") return email;
    if (cmd === "get_config") return { ...defaultConfig, ...config };
    return undefined;
  });
}

function open(category: SettingsCategory) {
  useAppStore.setState({ category });
  return render(<SettingsWindow />);
}

describe("<SettingsWindow />", () => {
  beforeEach(() => {
    mockInvoke();
    vi.mocked(autostart.isEnabled).mockResolvedValue(false);
  });

  it("switches page from the category menu", async () => {
    const user = userEvent.setup();
    open("capture");
    await screen.findByRole("heading", { name: /^capture$/i });

    await user.click(screen.getByRole("button", { name: /^general$/i }));

    expect(
      await screen.findByRole("heading", { name: /^general$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^general$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("always shows the active hosting and its account", async () => {
    open("capture");
    expect(await screen.findByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText(/active hosting/i)).toBeInTheDocument();
  });

  describe("Capture", () => {
    it("shows each shortcut with what it does", async () => {
      open("capture");
      expect(await screen.findByTestId("profile-0")).toHaveTextContent(
        "Ctrl + Print Screen",
      );
      expect(screen.getByRole("button", { name: /^region$/i })).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: /what to capture/i }),
      ).toBeInTheDocument();
    });

    it("saves the capture mode of a shortcut", async () => {
      const user = userEvent.setup();
      open("capture");
      await user.click(await screen.findByRole("button", { name: /^full screen$/i }));

      expect(invoke).toHaveBeenCalledWith("save_profiles", {
        profiles: [
          { hotkey: "Ctrl+PrintScreen", mode: "full_screen", after: "ask" },
        ],
      });
      expect(
        await screen.findByRole("button", { name: /^full screen$/i }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("warns next to the option when sharing directly", async () => {
      const user = userEvent.setup();
      open("capture");
      expect(screen.queryByText(/link is public/i)).not.toBeInTheDocument();

      await user.click(
        await screen.findByRole("button", { name: /^share directly$/i }),
      );

      expect(await screen.findByText(/link is public/i)).toBeInTheDocument();
      expect(screen.getByText(/no confirmation/i)).toBeInTheDocument();
    });

    it("persists changed keys through save_profiles", async () => {
      const user = userEvent.setup();
      open("capture");
      await user.click(await screen.findByRole("button", { name: /change keys/i }));
      await user.keyboard("{Control>}q{/Control}");

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("save_profiles", {
          profiles: [{ hotkey: "Ctrl+Q", mode: "ask", after: "ask" }],
        });
      });
    });

    it("adds a shortcut, up to three", async () => {
      const user = userEvent.setup();
      const profiles: AppConfig["profiles"] = [
        { hotkey: "Ctrl+1", mode: "ask", after: "ask" },
        { hotkey: "Ctrl+2", mode: "region", after: "share" },
      ];
      mockInvoke({ profiles });
      open("capture");

      await user.click(await screen.findByRole("button", { name: /add a shortcut/i }));
      await user.keyboard("{Control>}{Alt>}k{/Alt}{/Control}");

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("save_profiles", {
          profiles: [
            ...profiles,
            { hotkey: "Ctrl+Alt+K", mode: "ask", after: "ask" },
          ],
        });
      });
      await screen.findByTestId("profile-2");
      expect(
        screen.queryByRole("button", { name: /add a shortcut/i }),
      ).not.toBeInTheDocument();
    });

    it("can't delete the only shortcut", async () => {
      open("capture");
      await screen.findByTestId("profile-0");
      expect(
        screen.queryByRole("button", { name: /delete this shortcut/i }),
      ).not.toBeInTheDocument();
    });

    it("deletes the open shortcut when there are several", async () => {
      const user = userEvent.setup();
      mockInvoke({
        profiles: [
          { hotkey: "Ctrl+1", mode: "ask", after: "ask" },
          { hotkey: "Ctrl+2", mode: "region", after: "ask" },
        ],
      });
      open("capture");
      await user.click(await screen.findByRole("button", { name: /delete this shortcut/i }));

      expect(invoke).toHaveBeenCalledWith("save_profiles", {
        profiles: [{ hotkey: "Ctrl+2", mode: "region", after: "ask" }],
      });
    });

    it("explains a refused combination and keeps the old one", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "get_account_email") return "user@example.com";
        if (cmd === "get_config") return defaultConfig;
        if (cmd === "save_profiles") throw "hotkey_unavailable";
        return undefined;
      });
      const user = userEvent.setup();
      open("capture");
      await user.click(await screen.findByRole("button", { name: /change keys/i }));
      await user.keyboard("{Control>}q{/Control}");

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /taken by another application/i,
      );
      expect(screen.getByTestId("profile-0")).toHaveTextContent(
        "Ctrl + Print Screen",
      );
      expect(screen.queryByText(/shortcut saved/i)).not.toBeInTheDocument();
    });

    it("keeps listening for a new shortcut after a refusal, and can cancel", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "get_account_email") return "user@example.com";
        if (cmd === "get_config") return defaultConfig;
        if (cmd === "save_profiles") throw "hotkey_unavailable";
        return undefined;
      });
      const user = userEvent.setup();
      open("capture");
      await user.click(await screen.findByRole("button", { name: /add a shortcut/i }));
      await user.keyboard("{Control>}q{/Control}");
      await screen.findByRole("alert");

      await user.click(await screen.findByRole("button", { name: /^cancel$/i }));

      expect(
        await screen.findByRole("button", { name: /add a shortcut/i }),
      ).toBeInTheDocument();
    });

    it("shows the remembered choice and resets it", async () => {
      const user = userEvent.setup();
      mockInvoke({ last_choice: { mode: "window", after: "edit" } });
      open("capture");
      expect(
        await screen.findByText(/remembered: window · edit/i),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^reset$/i }));

      expect(invoke).toHaveBeenCalledWith("reset_last_choice");
      expect(await screen.findByText(/no choice remembered/i)).toBeInTheDocument();
    });
  });

  describe("Hosting", () => {
    it("shows the Drive account and folder", async () => {
      open("hosting");
      const email = await screen.findAllByText("user@example.com");
      expect(email.length).toBeGreaterThan(0);
      expect(screen.getByText(/drive folder: snap2link/i)).toBeInTheDocument();
    });

    it("disconnects then re-authenticates when Switch account is clicked", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "get_account_email") return "old@example.com";
        if (cmd === "get_config") return defaultConfig;
        if (cmd === "authenticate") return "new@example.com";
        return undefined;
      });
      const user = userEvent.setup();
      open("hosting");
      await user.click(await screen.findByRole("button", { name: /switch account/i }));

      expect(await screen.findByText(/signed in: new@example.com/i)).toBeInTheDocument();
      expect(invoke).toHaveBeenCalledWith("disconnect");
      expect(invoke).toHaveBeenCalledWith("authenticate");
    });

    it("stays in the settings after signing out, ready to reconnect", async () => {
      const user = userEvent.setup();
      open("hosting");
      await user.click(await screen.findByRole("button", { name: /sign out/i }));

      expect(invoke).toHaveBeenCalledWith("disconnect");
      expect(
        await screen.findByRole("button", { name: /connect google drive/i }),
      ).toBeInTheDocument();
      expect(screen.getAllByText(/not connected/i).length).toBeGreaterThan(0);
    });

    it("connects a Google account from the page", async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "get_account_email") return null;
        if (cmd === "get_config") return defaultConfig;
        if (cmd === "authenticate") return "new@example.com";
        return undefined;
      });
      const user = userEvent.setup();
      open("hosting");
      await user.click(
        await screen.findByRole("button", { name: /connect google drive/i }),
      );

      expect(await screen.findByText(/signed in: new@example.com/i)).toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalledWith("disconnect");
    });

    it("only shows the options of the chosen host", async () => {
      const user = userEvent.setup();
      open("hosting");
      expect(await screen.findByText(/drive folder: snap2link/i)).toBeInTheDocument();
      expect(screen.queryByText(/links last 24 hours/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^snap2link/i }));

      expect(invoke).toHaveBeenCalledWith("set_hosting", { hosting: "snap2link" });
      expect(await screen.findByText(/links last 24 hours/i)).toBeInTheDocument();
      expect(screen.queryByText(/drive folder/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: /automatic deletion/i })).not.toBeInTheDocument();
    });

    it("shows the active host in the menu, whatever the page", async () => {
      mockInvoke({ hosting: "snap2link" });
      open("capture");
      const button = await screen.findByRole("button", { name: /active hosting/i });
      expect(button).toHaveTextContent(/snap2link/i);
      expect(button).toHaveTextContent(/no account/i);
    });

    it("toggles automatic deletion via save_config", async () => {
      const user = userEvent.setup();
      open("hosting");
      await user.click(
        await screen.findByRole("switch", { name: /automatic deletion/i }),
      );

      expect(invoke).toHaveBeenCalledWith("save_config", {
        retentionDays: 30,
        autoDelete: false,
      });
    });

    it("persists a new retention via save_config", async () => {
      const user = userEvent.setup();
      open("hosting");
      const input = await screen.findByLabelText(/keep captures for/i);
      await user.clear(input);
      await user.type(input, "60");
      await user.click(screen.getByRole("button", { name: /^save$/i }));

      expect(invoke).toHaveBeenCalledWith("save_config", {
        retentionDays: 60,
        autoDelete: true,
      });
    });
  });

  describe("General", () => {
    it("toggles startup via plugin-autostart", async () => {
      const user = userEvent.setup();
      open("general");
      await user.click(
        await screen.findByRole("switch", { name: /start with your computer/i }),
      );
      expect(autostart.enable).toHaveBeenCalledTimes(1);
    });

    it("saves the link message setting", async () => {
      const user = userEvent.setup();
      open("general");
      await user.click(await screen.findByRole("switch", { name: /link copied/i }));
      expect(invoke).toHaveBeenCalledWith("save_notify_link", { enabled: false });
    });

    it("lists every language and applies the choice", async () => {
      const user = userEvent.setup();
      open("general");
      const select = await screen.findByLabelText(/^language$/i);
      expect(within(select).getAllByRole("option")).toHaveLength(21);

      await user.selectOptions(select, "ja");

      expect(invoke).toHaveBeenCalledWith("set_language", { language: "ja" });
    });

    it("runs the update check when the tray asked for it", async () => {
      const onUpdatesChecked = vi.fn();
      useAppStore.setState({ category: "general" });
      render(<SettingsWindow autoCheckUpdates onUpdatesChecked={onUpdatesChecked} />);

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("check_for_update");
      });
      expect(onUpdatesChecked).toHaveBeenCalled();
    });
  });
});
