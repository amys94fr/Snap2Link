import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-shell";
import { AboutWindow } from "./AboutWindow";

describe("<AboutWindow />", () => {
  it("displays app name, version, author and license", () => {
    render(<AboutWindow onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: /snap2link/i })).toBeInTheDocument();
    expect(screen.getByText(/version 1\.0\.0/i)).toBeInTheDocument();
    expect(screen.getByTestId("author")).toHaveTextContent("Steven Abittan");
    // "MIT License" appears in the dd row and again in the license body —
    // assert that the row is present.
    expect(screen.getAllByText(/MIT License/i).length).toBeGreaterThan(0);
  });

  it("displays the description", () => {
    render(<AboutWindow onClose={() => {}} />);
    expect(
      screen.getByText(
        /capture a screen region and instantly get a google drive share link/i,
      ),
    ).toBeInTheDocument();
  });

  it("opens the GitHub URL via plugin-shell when the link is clicked", async () => {
    const user = userEvent.setup();
    render(<AboutWindow onClose={() => {}} />);
    const link = screen.getByRole("button", { name: /amys94fr/i });
    await user.click(link);
    expect(open).toHaveBeenCalledWith("https://github.com/amys94fr");
  });

  it("calls onClose when Close is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AboutWindow onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("displays the full MIT license text", () => {
    render(<AboutWindow onClose={() => {}} />);
    expect(
      screen.getByText(/permission is hereby granted, free of charge/i),
    ).toBeInTheDocument();
  });
});
