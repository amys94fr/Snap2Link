//! Global keyboard shortcuts: one per capture profile.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::commands::config::{
    load_config, AfterCapture, CaptureMode, CaptureProfile, LastAfter, LastMode,
};

/// Read when a key is pressed, so changing a profile's behaviour doesn't need
/// the shortcut to be registered again.
static BINDINGS: Mutex<Vec<Binding>> = Mutex::new(Vec::new());

#[derive(Clone, Copy)]
struct Binding {
    shortcut: Shortcut,
    mode: CaptureMode,
    after: AfterCapture,
}

/// Sent to the overlay, which runs the capture.
#[derive(Clone, Debug, Serialize)]
struct CaptureRequest {
    mode: CaptureMode,
    after: AfterCapture,
    last_mode: Option<LastMode>,
    last_after: Option<LastAfter>,
}

pub fn parse_hotkey(hotkey: &str) -> Result<Shortcut, String> {
    hotkey
        .parse::<Shortcut>()
        .map_err(|e| format!("invalid hotkey '{hotkey}': {e}"))
}

/// Starts a capture. The tray uses `Ask` for both steps: a click on the icon
/// must never share something without confirmation.
pub fn trigger(app: &AppHandle, mode: CaptureMode, after: AfterCapture) {
    let last = load_config().last_choice;
    let _ = app.emit(
        "trigger-screenshot",
        CaptureRequest {
            mode,
            after,
            last_mode: last.mode,
            last_after: last.after,
        },
    );
}

fn on_pressed(app: &AppHandle, pressed: &Shortcut) {
    let binding = BINDINGS
        .lock()
        .ok()
        .and_then(|b| b.iter().find(|b| b.shortcut == *pressed).copied());
    if let Some(binding) = binding {
        eprintln!("[snap2link] hotkey pressed");
        trigger(app, binding.mode, binding.after);
    }
}

/// Makes the registered shortcuts match `profiles`.
///
/// New shortcuts are registered before the old ones go. If one that
/// `may_fail` doesn't excuse is refused, everything is rolled back, so a taken
/// combination never leaves the user without a working shortcut. An excused
/// failure is logged and the other shortcuts still work.
pub fn sync(
    app: &AppHandle,
    profiles: &[CaptureProfile],
    may_fail: impl Fn(&Shortcut) -> bool,
) -> Result<(), String> {
    let mut wanted = Vec::with_capacity(profiles.len());
    for profile in profiles {
        match parse_hotkey(&profile.hotkey) {
            Ok(shortcut) => wanted.push(Binding {
                shortcut,
                mode: profile.mode,
                after: profile.after,
            }),
            // `save_profiles` validates first: only a hand-edited file gets here.
            Err(e) => eprintln!("[snap2link] {e}"),
        }
    }

    // Not held while registering: a key press needs this lock on another
    // thread, and the plugin may wait for the event loop.
    let previous: Vec<Shortcut> = BINDINGS
        .lock()
        .map_err(|_| "hotkey state poisoned".to_string())?
        .iter()
        .map(|b| b.shortcut)
        .collect();

    let mgr = app.global_shortcut();
    let mut added = Vec::new();
    let mut failed = Vec::new();
    for binding in &wanted {
        let shortcut = binding.shortcut;
        if previous.contains(&shortcut) && mgr.is_registered(shortcut) {
            continue;
        }
        let handle = app.clone();
        let registered = mgr.on_shortcut(shortcut, move |_app, pressed, event| {
            if event.state == ShortcutState::Pressed {
                on_pressed(&handle, pressed);
            }
        });
        match registered {
            Ok(()) => added.push(shortcut),
            Err(e) if may_fail(&shortcut) => {
                eprintln!("[snap2link] shortcut refused: {e}");
                failed.push(shortcut);
            }
            Err(e) => {
                eprintln!("[snap2link] shortcut refused: {e}");
                for shortcut in added {
                    let _ = mgr.unregister(shortcut);
                }
                return Err("hotkey_unavailable".to_string());
            }
        }
    }

    for old in previous {
        if !wanted.iter().any(|b| b.shortcut == old) {
            let _ = mgr.unregister(old);
        }
    }

    wanted.retain(|b| !failed.contains(&b.shortcut));
    *BINDINGS
        .lock()
        .map_err(|_| "hotkey state poisoned".to_string())? = wanted;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_and_rejects_garbage() {
        assert!(parse_hotkey(crate::commands::config::DEFAULT_HOTKEY).is_ok());
        assert!(parse_hotkey("Ctrl+Alt+P").is_ok());
        assert!(parse_hotkey("").is_err());
        assert!(parse_hotkey("Ctrl+NotAKey").is_err());
    }
}
