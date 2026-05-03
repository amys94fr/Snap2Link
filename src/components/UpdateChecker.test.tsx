import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { UpdateChecker } from "./UpdateChecker";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("<UpdateChecker />", () => {
  it("renders the Check for Updates button by default", () => {
    render(<UpdateChecker />);
    expect(
      screen.getByRole("button", { name: /check for updates/i }),
    ).toBeInTheDocument();
  });

  it("shows the up-to-date message when no update is available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: false,
      currentVersion: "1.0.0",
      latestVersion: null,
      releaseNotes: null,
    } as never);
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );
    await waitFor(() => {
      expect(screen.getByText(/up to date/i)).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith("check_for_update");
  });

  it("offers to install when an update is available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      releaseNotes: "- bug fixes",
    } as never);
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );
    await waitFor(() => {
      expect(screen.getByText(/update available: v1\.1\.0/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /download/i }),
    ).toBeInTheDocument();
  });

  it("invokes install_update when the install button is clicked", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "check_for_update") {
        return {
          available: true,
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          releaseNotes: null,
        };
      }
      if (cmd === "install_update") return undefined;
      return undefined;
    });
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /download/i }),
    );
    await user.click(screen.getByRole("button", { name: /download/i }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_update");
    });
  });

  it("displays an error when the check fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<UpdateChecker />);
    await user.click(
      screen.getByRole("button", { name: /check for updates/i }),
    );
    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeInTheDocument();
    });
  });

  it("triggers the check immediately when autoStart is true", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: false,
      currentVersion: "1.0.0",
      latestVersion: null,
      releaseNotes: null,
    } as never);
    render(<UpdateChecker autoStart />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_for_update");
    });
  });
});
