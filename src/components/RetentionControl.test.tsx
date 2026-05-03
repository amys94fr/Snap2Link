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
    const input = screen.getByLabelText(/keep screenshots for/i);
    expect(input).toHaveValue(30);
    const toggle = screen.getByRole("checkbox", { name: /auto-delete/i });
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
    await user.click(screen.getByRole("checkbox", { name: /auto-delete/i }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("disables the input and the OK button when not enabled", () => {
    render(
      <RetentionControl
        days={30}
        enabled={false}
        onToggle={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByLabelText(/keep screenshots for/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /ok/i })).toBeDisabled();
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
    const input = screen.getByLabelText(/keep screenshots for/i);
    await user.clear(input);
    await user.type(input, "60");
    await user.click(screen.getByRole("button", { name: /ok/i }));
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
    const input = screen.getByLabelText(/keep screenshots for/i);

    await user.clear(input);
    await user.type(input, "0");
    await user.click(screen.getByRole("button", { name: /ok/i }));
    expect(onSave).toHaveBeenLastCalledWith(1);

    await user.clear(input);
    await user.type(input, "9999");
    await user.click(screen.getByRole("button", { name: /ok/i }));
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
    await user.click(screen.getByRole("button", { name: /ok/i }));
    expect(
      screen.getByText(/screenshots deleted after 30 days/i),
    ).toBeInTheDocument();
  });
});
