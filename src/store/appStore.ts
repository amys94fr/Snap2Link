import { create } from "zustand";

export type AppPage = "wizard" | "settings" | "about";

export interface AppState {
  page: AppPage;
  isAuthenticated: boolean;
  /** When set, Settings opens with the UpdateChecker already running.
   *  Consumed exactly once — read it then call `consumeAutoCheckUpdates`. */
  autoCheckUpdates: boolean;
  setPage: (page: AppPage) => void;
  setAuthenticated: (value: boolean) => void;
  requestAutoCheckUpdates: () => void;
  consumeAutoCheckUpdates: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  page: "wizard",
  isAuthenticated: false,
  autoCheckUpdates: false,
  setPage: (page) => set({ page }),
  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  requestAutoCheckUpdates: () =>
    set({ page: "settings", autoCheckUpdates: true }),
  consumeAutoCheckUpdates: () => set({ autoCheckUpdates: false }),
}));
