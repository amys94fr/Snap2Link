import { create } from "zustand";

export type AppPage = "wizard" | "settings" | "about";
export type SettingsCategory = "capture" | "hosting" | "general" | "about";

export interface AppState {
  page: AppPage;
  category: SettingsCategory;
  setupDone: boolean;
  /** When set, Settings opens with the UpdateChecker already running.
   *  Consumed exactly once — read it then call `consumeAutoCheckUpdates`. */
  autoCheckUpdates: boolean;
  setPage: (page: AppPage) => void;
  setCategory: (category: SettingsCategory) => void;
  setSetupDone: (value: boolean) => void;
  requestAutoCheckUpdates: () => void;
  consumeAutoCheckUpdates: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: "wizard",
  category: "capture",
  setupDone: false,
  autoCheckUpdates: false,
  setPage: (page) =>
    set(page === "about" ? { page, category: "about" } : { page }),
  setCategory: (category) => set({ category }),
  setSetupDone: (setupDone) => set({ setupDone }),
  requestAutoCheckUpdates: () =>
    set({ page: "settings", category: "general", autoCheckUpdates: true }),
  consumeAutoCheckUpdates: () => set({ autoCheckUpdates: false }),
}));
