// Declaring the app commands makes Tauri generate an `allow-<command>`
// permission for each one. Commands are then denied to every window unless
// a capability in `capabilities/` grants them explicitly.
const COMMANDS: &[&str] = &[
    "get_config",
    "save_config",
    "is_authenticated",
    "authenticate",
    "get_account_email",
    "disconnect",
    "upload_screenshot",
    "capture_region",
    "capture_full_screen",
    "list_windows",
    "capture_window",
    "write_annotated_image",
    "check_for_update",
    "install_update",
    "capture_at_cursor",
    "capture_active_window",
    "delete_last_upload",
    "save_profiles",
    "save_last_choice",
    "reset_last_choice",
    "save_notify_link",
    "get_language",
    "set_language",
    "show_toast",
    "hide_toast",
    "debug_log",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
