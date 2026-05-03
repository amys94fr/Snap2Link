import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HotkeyRecorder } from "./HotkeyRecorder";

describe("<HotkeyRecorder />", () => {
  it("renders the current combo formatted for humans", () => {
    render(<HotkeyRecorder current="Ctrl+PrintScreen" onChange={() => {}} />);
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent(
      "Ctrl + Print Screen",
    );
  });

  it("toggles to recording mode when Edit is clicked", async () => {
    const user = userEvent.setup();
    render(<HotkeyRecorder current="Ctrl+S" onChange={() => {}} />);
    expect(screen.getByRole("button")).toHaveTextContent(/edit/i);

    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent(/cancel/i);
    // While recording the display becomes a placeholder
    expect(screen.getByTestId("hotkey-display")).toHaveTextContent("…");
  });

  it("captures a key combo and calls onChange with the Tauri format", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<HotkeyRecorder current="Ctrl+S" onChange={onChange} />);
    await user.click(screen.getByRole("button"));

    await user.keyboard("{Control>}{Shift>}p{/Shift}{/Control}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Ctrl+Shift+P");
    // Recording exits after a successful capture
    expect(screen.getByRole("button")).toHaveTextContent(/edit/i);
  });

  it("Escape cancels recording without calling onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<HotkeyRecorder current="Ctrl+S" onChange={onChange} />);
    await user.click(screen.getByRole("button"));
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent(/edit/i);
  });

  it("clicking Cancel during recording exits without calling onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<HotkeyRecorder current="Ctrl+S" onChange={onChange} />);
    await user.click(screen.getByRole("button")); // Edit → recording
    await user.click(screen.getByRole("button")); // Cancel

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent(/edit/i);
  });

  it("ignores presses of modifier keys alone while recording", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<HotkeyRecorder current="Ctrl+S" onChange={onChange} />);
    await user.click(screen.getByRole("button"));

    await user.keyboard("{Control}"); // press + release modifier only

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent(/cancel/i);
  });

  it("shows the saved-success hint after a successful capture", async () => {
    const user = userEvent.setup();
    render(<HotkeyRecorder current="Ctrl+S" onChange={() => {}} />);
    await user.click(screen.getByRole("button"));
    await user.keyboard("{Control>}q{/Control}");

    expect(screen.getByText(/shortcut saved/i)).toBeInTheDocument();
  });
});
