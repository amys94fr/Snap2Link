/** Mirrors `AppConfig` in src-tauri/src/commands/config.rs. */

export type ProfileMode = "ask" | "region" | "full_screen" | "active_window";
export type ProfileAfter = "ask" | "share" | "annotate";

export interface CaptureProfile {
  hotkey: string;
  mode: ProfileMode;
  after: ProfileAfter;
}

export type LastMode = "region" | "fullScreen" | "window";
export type LastAfter = "edit" | "save";

export interface LastChoice {
  mode?: LastMode | null;
  after?: LastAfter | null;
}

export interface AppConfig {
  hotkey: string;
  retention_days: number;
  auto_delete: boolean;
  folder_id?: string;
  profiles: CaptureProfile[];
  last_choice: LastChoice;
  language: string;
  notify_link: boolean;
}

export const MAX_PROFILES = 3;
