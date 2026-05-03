import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { enable } from "@tauri-apps/plugin-autostart";
import { SetupWizard } from "./SetupWizard";

describe("<SetupWizard />", () => {
  it("starts on the welcome step", () => {
    render(<SetupWizard onComplete={() => {}} />);
    expect(screen.getByRole("heading", { name: /snap2link/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /get started/i }),
    ).toBeInTheDocument();
  });

  it("advances to the connect step when 'Get Started' is clicked", async () => {
    const user = userEvent.setup();
    render(<SetupWizard onComplete={() => {}} />);
    await user.click(screen.getByRole("button", { name: /get started/i }));
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
    await user.click(screen.getByRole("button", { name: /get started/i }));
    await user.click(
      screen.getByRole("button", { name: /connect google drive/i }),
    );
    expect(invoke).toHaveBeenCalledWith("authenticate");
  });

  it("shows the success step with the email when authentication succeeds", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("user@example.com" as never);
    const user = userEvent.setup();
    render(<SetupWizard onComplete={() => {}} />);
    await user.click(screen.getByRole("button", { name: /get started/i }));
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
    await user.click(screen.getByRole("button", { name: /get started/i }));
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
    await user.click(screen.getByRole("button", { name: /get started/i }));
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
