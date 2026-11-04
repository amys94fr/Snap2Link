import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { enable } from "@tauri-apps/plugin-autostart";
import { SetupWizard } from "./SetupWizard";

describe("<SetupWizard />", () => {
  it("can start without any account", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<SetupWizard onComplete={onComplete} />);

    await user.click(
      screen.getByRole("button", { name: /start without an account/i }),
    );

    expect(invoke).toHaveBeenCalledWith("set_hosting", { hosting: "snap2link" });
    expect(invoke).not.toHaveBeenCalledWith("authenticate");
    expect(enable).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("starts on the welcome step", () => {
    render(<SetupWizard onComplete={() => {}} />);
    expect(screen.getByRole("heading", { name: /snap2link/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use my google drive/i }),
    ).toBeInTheDocument();
  });

  it("advances to the connect step for Google Drive", async () => {
    const user = userEvent.setup();
    render(<SetupWizard onComplete={() => {}} />);
    await user.click(screen.getByRole("button", { name: /use my google drive/i }));
    expect(
      screen.getByRole("heading", { name: /connect google drive/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /connect google drive/i }),
    ).toBeInTheDocument();
  });

  it("calls invoke('authenticate') when the Connect button is clicked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("user@example.com" as never);
    const user = userEvent.setup();
    render(<SetupWizard onComplete={() => {}} />);
    await user.click(screen.getByRole("button", { name: /use my google drive/i }));
    await user.click(
      screen.getByRole("button", { name: /connect google drive/i }),
    );
    expect(invoke).toHaveBeenCalledWith("authenticate");
  });

  it("shows the success step with the email when authentication succeeds", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("user@example.com" as never);
    const user = userEvent.setup();
    render(<SetupWizard onComplete={() => {}} />);
    await user.click(screen.getByRole("button", { name: /use my google drive/i }));
    await user.click(
      screen.getByRole("button", { name: /connect google drive/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("user@example.com")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /finish/i })).toBeInTheDocument();
  });

  it("displays an error and a Retry button on auth failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<SetupWizard onComplete={() => {}} />);
    await user.click(screen.getByRole("button", { name: /use my google drive/i }));
    await user.click(
      screen.getByRole("button", { name: /connect google drive/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("enables autostart and calls onComplete when Finish is clicked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("user@example.com" as never);
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<SetupWizard onComplete={onComplete} />);
    await user.click(screen.getByRole("button", { name: /use my google drive/i }));
    await user.click(
      screen.getByRole("button", { name: /connect google drive/i }),
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /finish/i }),
    );
    await user.click(screen.getByRole("button", { name: /finish/i }));

    expect(enable).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
