import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RetentionControl } from "./RetentionControl";

describe("<RetentionControl />", () => {
  it("renders the days input and the toggle in the configured state", () => {
    render(
      <RetentionControl
        days={30}
        enabled={true}
        onToggle={() => {}}
        onSave={() => {}}
      />,
    );
    const input = screen.getByLabelText(/keep captures for/i);
    expect(input).toHaveValue(30);
    const toggle = screen.getByRole("switch", { name: /automatic deletion/i });
    expect(toggle).toBeChecked();
  });

  it("toggling the checkbox calls onToggle with the new value", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <RetentionControl
        days={30}
        enabled={true}
        onToggle={onToggle}
        onSave={() => {}}
      />,
    );
    await user.click(screen.getByRole("switch", { name: /automatic deletion/i }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("hides the delay when automatic deletion is off", () => {
    render(
      <RetentionControl
        days={30}
        enabled={false}
        onToggle={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/keep captures for/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("clicking OK calls onSave with the entered days", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <RetentionControl
        days={30}
        enabled={true}
        onToggle={() => {}}
        onSave={onSave}
      />,
    );
    const input = screen.getByLabelText(/keep captures for/i);
    await user.clear(input);
    await user.type(input, "60");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith(60);
  });

  it("clamps the days value to the [1, 3650] range on save", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <RetentionControl
        days={30}
        enabled={true}
        onToggle={() => {}}
        onSave={onSave}
      />,
    );
    const input = screen.getByLabelText(/keep captures for/i);

    await user.clear(input);
    await user.type(input, "0");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenLastCalledWith(1);

    await user.clear(input);
    await user.type(input, "9999");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenLastCalledWith(3650);
  });

  it("shows a confirmation hint after saving", async () => {
    const user = userEvent.setup();
    render(
      <RetentionControl
        days={30}
        enabled={true}
        onToggle={() => {}}
        onSave={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(
      screen.getByText(/deleted after 30 days/i),
    ).toBeInTheDocument();
  });
});
