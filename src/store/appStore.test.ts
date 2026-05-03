import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";

describe("appStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      page: "wizard",
      isAuthenticated: false,
      autoCheckUpdates: false,
    });
  });

  it("starts on the wizard page when not authenticated", () => {
    const { page, isAuthenticated } = useAppStore.getState();
    expect(page).toBe("wizard");
    expect(isAuthenticated).toBe(false);
  });

  it("setPage updates the current page", () => {
    useAppStore.getState().setPage("settings");
    expect(useAppStore.getState().page).toBe("settings");

    useAppStore.getState().setPage("about");
    expect(useAppStore.getState().page).toBe("about");
  });

  it("setAuthenticated toggles authentication state", () => {
    useAppStore.getState().setAuthenticated(true);
    expect(useAppStore.getState().isAuthenticated).toBe(true);

    useAppStore.getState().setAuthenticated(false);
    expect(useAppStore.getState().isAuthenticated).toBe(false);
  });

  it("only accepts valid page values via TypeScript", () => {
    // This is a compile-time check; the test exists to lock the contract.
    // @ts-expect-error invalid page name should be rejected at compile time
    useAppStore.getState().setPage("invalid-page");
  });

  it("requestAutoCheckUpdates flips to settings + autoCheckUpdates=true", () => {
    useAppStore.getState().requestAutoCheckUpdates();
    expect(useAppStore.getState().page).toBe("settings");
    expect(useAppStore.getState().autoCheckUpdates).toBe(true);
  });

  it("consumeAutoCheckUpdates resets the flag", () => {
    useAppStore.setState({ autoCheckUpdates: true });
    useAppStore.getState().consumeAutoCheckUpdates();
    expect(useAppStore.getState().autoCheckUpdates).toBe(false);
  });
});
