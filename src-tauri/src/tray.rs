//! System tray icon + context menu.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

use crate::{
    commands::config::{AfterCapture, CaptureMode},
    hotkey, i18n,
};

const TRAY_ID: &str = "main";

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let lang = i18n::current();
    let item = |id: &str, label: String| MenuItem::with_id(app, id, label, true, None::<&str>);

    let screenshot = item("screenshot", i18n::tr(lang, "tray.screenshot"))?;
    let settings = item("settings", i18n::tr(lang, "tray.settings"))?;
    let check_updates = item("check-updates", i18n::tr(lang, "tray.check_updates"))?;
    let about = item(
        "about",
        i18n::tr(lang, "tray.about").replace("{version}", env!("CARGO_PKG_VERSION")),
    )?;
    let quit = item("quit", i18n::tr(lang, "tray.quit"))?;

    Menu::with_items(
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
    )
}

/// Rebuilds the menu after a language change.
pub fn refresh_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_menu(app)?))?;
    }
    Ok(())
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;

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

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Snap2Link")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "screenshot" => {
                eprintln!("[snap2link] tray menu: screenshot");
                hotkey::trigger(app, CaptureMode::Ask, AfterCapture::Ask);
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
                hotkey::trigger(tray.app_handle(), CaptureMode::Ask, AfterCapture::Ask);
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
