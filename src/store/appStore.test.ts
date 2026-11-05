import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";

describe("appStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      page: "wizard",
      setupDone: false,
      autoCheckUpdates: false,
    });
  });

  it("starts on the wizard page", () => {
    const { page, setupDone } = useAppStore.getState();
    expect(page).toBe("wizard");
    expect(setupDone).toBe(false);
  });

  it("setPage updates the current page", () => {
    useAppStore.getState().setPage("settings");
    expect(useAppStore.getState().page).toBe("settings");

    useAppStore.getState().setPage("about");
    expect(useAppStore.getState().page).toBe("about");
  });

  it("setSetupDone records the end of setup", () => {
    useAppStore.getState().setSetupDone(true);
    expect(useAppStore.getState().setupDone).toBe(true);

    useAppStore.getState().setSetupDone(false);
    expect(useAppStore.getState().setupDone).toBe(false);
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
