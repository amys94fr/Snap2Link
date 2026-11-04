import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AboutWindow } from "./AboutWindow";
import { version } from "../../package.json";

describe("<AboutWindow />", () => {
  it("displays app name, version, author and license", () => {
    render(<AboutWindow />);
    expect(screen.getByRole("heading", { name: /snap2link/i })).toBeInTheDocument();
    expect(screen.getByText(`Version ${version}`)).toBeInTheDocument();
    expect(screen.getByTestId("author")).toHaveTextContent("Steven Abittan");
    // "MIT License" appears in the dd row and again in the license body —
    // assert that the row is present.
    expect(screen.getAllByText(/MIT License/i).length).toBeGreaterThan(0);
  });

  it("displays the description", () => {
    render(<AboutWindow />);
    expect(
      screen.getByText(
        /capture your screen and instantly get a link/i,
      ),
    ).toBeInTheDocument();
  });

  it("opens the GitHub URL via plugin-opener when the link is clicked", async () => {
    const user = userEvent.setup();
    render(<AboutWindow />);
    const link = screen.getByRole("button", { name: /amys94fr/i });
    await user.click(link);
    expect(openUrl).toHaveBeenCalledWith("https://github.com/amys94fr");
  });

  it("displays the full MIT license text", () => {
    render(<AboutWindow />);
    expect(
      screen.getByText(/permission is hereby granted, free of charge/i),
    ).toBeInTheDocument();
  });
});
