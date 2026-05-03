//! System tray icon + context menu.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let screenshot = MenuItem::with_id(
        app,
        "screenshot",
        "Take Screenshot",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(
        app,
        "check-updates",
        "Check for Updates",
        true,
        None::<&str>,
    )?;
    let about = MenuItem::with_id(
        app,
        "about",
        format!("About Snap2Link  •  v{}", env!("CARGO_PKG_VERSION")),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Snap2Link", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &screenshot,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &check_updates,
            &about,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    // Try the runtime-supplied icon first (it picks the right size for the
    // platform); fall back to a known PNG bundled at compile time so the tray
    // never disappears in dev builds.
    let icon = match app.default_window_icon().cloned() {
        Some(icon) => icon,
        None => {
            const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
            tauri::image::Image::from_bytes(ICON_PNG)
                .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!("tray icon decode: {e}")))?
        }
    };

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Snap2Link")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "screenshot" => {
                eprintln!("[snap2link] tray menu: screenshot");
                let _ = app.emit("trigger-screenshot", ());
            }
            "settings" => show_main(app, "settings"),
            "check-updates" => show_main(app, "check-updates"),
            "about" => show_main(app, "about"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                eprintln!("[snap2link] tray icon: left-click");
                let _ = tray.app_handle().emit("trigger-screenshot", ());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main(app: &AppHandle, page: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("navigate", page.to_string());
        let _ = window.show();
        let _ = window.set_focus();
    }
}
