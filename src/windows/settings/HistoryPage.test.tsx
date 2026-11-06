import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useAppStore } from "@/store/appStore";
import { HistoryPage } from "./HistoryPage";

const HOUR = 3_600_000;

function entry(id: string, overrides = {}) {
  return {
    id,
    url: `https://i.snap2link.app/${id}`,
    thumbnail: `https://i.snap2link.app/${id}`,
    created_at: new Date(Date.now() - HOUR).toISOString(),
    expires_at: new Date(Date.now() + 47 * HOUR).toISOString(),
    kept: false,
    ...overrides,
  };
}

type Handler = (args?: Record<string, unknown>) => unknown;

function host(history: unknown, handlers: Record<string, Handler> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "get_history") {
      if (history instanceof Error) throw history;
      return history;
    }
    return handlers[cmd]?.(args as Record<string, unknown>);
  });
}

const rows = () => screen.findAllByRole("listitem");
const button = (row: HTMLElement, name: RegExp) => within(row).getByRole("button", { name });

describe("HistoryPage", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(writeText).mockReset();
  });

  it("says so when there's nothing yet", async () => {
    host({ entries: [], max_kept: 0 });
    render(<HistoryPage />);

    expect(await screen.findByText(/next capture/i)).toBeInTheDocument();
  });

  it("shows when a link ends", async () => {
    host({ entries: [entry("a")], max_kept: 5 });
    render(<HistoryPage />);

    expect(await screen.findByText(/Ends in 47 hours/)).toBeInTheDocument();
  });

  it("says when a capture has no end", async () => {
    host({ entries: [entry("a", { expires_at: null })], max_kept: null });
    render(<HistoryPage />);

    expect(await screen.findByText(/doesn't expire/i)).toBeInTheDocument();
  });

  it("copies the link", async () => {
    host({ entries: [entry("a")], max_kept: 0 });
    render(<HistoryPage />);
    const [row] = await rows();

    await userEvent.click(button(row, /copy/i));

    expect(writeText).toHaveBeenCalledWith("https://i.snap2link.app/a");
    expect(await within(row).findByText(/copied/i)).toBeInTheDocument();
  });

  it("offers no Keep to a guest, whose links nothing replaces", async () => {
    host({ entries: [entry("a")], max_kept: 0 });
    render(<HistoryPage />);
    const [row] = await rows();

    expect(within(row).queryByRole("button", { name: /keep/i })).not.toBeInTheDocument();
  });

  it("keeps a link and reads the list again", async () => {
    const set = vi.fn();
    host({ entries: [entry("a")], max_kept: 5 }, { set_capture_kept: set });
    render(<HistoryPage />);
    const [row] = await rows();

    await userEvent.click(button(row, /keep/i));

    await waitFor(() => expect(set).toHaveBeenCalledWith({ id: "a", kept: true }));
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_history")).toHaveLength(2),
    );
  });

  it("stops at the limit but can still release a kept link", async () => {
    host({ entries: [entry("a", { kept: true }), entry("b")], max_kept: 1 });
    render(<HistoryPage />);
    const [kept, other] = await rows();

    expect(button(kept, /keep/i)).toBeEnabled();
    expect(button(kept, /keep/i)).toHaveAttribute("aria-pressed", "true");
    expect(button(other, /keep/i)).toBeDisabled();
    expect(screen.getByText(/1 of 1 links kept/)).toBeInTheDocument();
  });

  it("explains a refused pin", async () => {
    host({ entries: [entry("a")], max_kept: 5 }, {
      set_capture_kept: () => {
        throw "relay_pin_limit";
      },
    });
    render(<HistoryPage />);
    const [row] = await rows();

    await userEvent.click(button(row, /keep/i));

    expect(await screen.findByRole("alert")).toHaveTextContent(/as many links/i);
  });

  it("asks before deleting, then removes the row", async () => {
    const remove = vi.fn();
    host({ entries: [entry("a"), entry("b")], max_kept: 0 }, { delete_capture: remove });
    render(<HistoryPage />);
    const [row] = await rows();

    await userEvent.click(button(row, /delete/i));
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(button(row, /delete/i));

    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: "a" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
  });

  it("keeps the row when the delete fails", async () => {
    host({ entries: [entry("a")], max_kept: 0 }, {
      delete_capture: () => {
        throw "nope";
      },
    });
    render(<HistoryPage />);
    const [row] = await rows();

    await userEvent.click(button(row, /delete/i));
    await userEvent.click(button(row, /delete/i));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("falls back on an icon when a thumbnail fails", async () => {
    host({ entries: [entry("a")], max_kept: 0 });
    render(<HistoryPage />);
    const image = await screen.findByRole("img");

    image.dispatchEvent(new Event("error"));

    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  });

  it("sends to Hosting when Drive isn't connected", async () => {
    host(new Error("drive_not_connected"));
    render(<HistoryPage />);

    await userEvent.click(await screen.findByRole("button", { name: /hosting/i }));

    expect(useAppStore.getState().category).toBe("hosting");
  });

  it("offers to try again after a failed load", async () => {
    host(new Error("relay_unreachable"));
    render(<HistoryPage />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    host({ entries: [entry("a")], max_kept: 0 });
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await rows()).toHaveLength(1);
  });
});
