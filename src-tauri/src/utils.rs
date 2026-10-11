//! Filesystem paths used across the app.
//!
//! All on-disk state lives in `~/AppData/Roaming/Snap2Link/` (Windows) or
//! `~/Library/Application Support/Snap2Link/` (macOS).
//!
//! Screenshots live in a private `captures/` folder under the app cache dir.
//! It is the only place the asset protocol is allowed to read from, and the
//! only place `upload_screenshot` accepts a path from.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

pub const APP_DIR_NAME: &str = "Snap2Link";
pub const CAPTURES_SUBDIR: &str = "captures";
pub const MAX_CAPTURE_BYTES: usize = 50 * 1024 * 1024;
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const CAPTURE_PREFIXES: &[&str] = &["cap-", "annotated-"];

pub fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DIR_NAME)
}

pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

pub fn ensure_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub fn token_path_in(dir: &Path) -> PathBuf {
    dir.join("token.json")
}

pub fn config_path_in(dir: &Path) -> PathBuf {
    dir.join("config.json")
}

/// Atomically replaces `path` with `bytes`, owner-only (0600) on Unix.
pub fn write_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    let _ = fs::remove_file(&tmp);
    {
        let mut f = new_private_file(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

/// `create_new` refuses to open an existing path, so a planted symlink is
/// never followed.
fn new_private_file(path: &Path) -> io::Result<fs::File> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
}

pub fn captures_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no app cache dir: {e}"))?
        .join(CAPTURES_SUBDIR);
    ensure_private_dir(&dir).map_err(|e| format!("cannot create captures dir: {e}"))?;
    Ok(dir)
}

pub fn new_capture_path(dir: &Path, prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    dir.join(format!("{prefix}{nanos}.png"))
}

pub fn write_capture_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut f = new_private_file(path)?;
    f.write_all(bytes)
}

pub fn is_png(bytes: &[u8]) -> bool {
    bytes.len() >= PNG_MAGIC.len() && bytes[..PNG_MAGIC.len()] == PNG_MAGIC
}

pub fn is_capture_file_name(name: &str) -> bool {
    CAPTURE_PREFIXES.iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|rest| rest.strip_suffix(".png"))
            .map(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
            .unwrap_or(false)
    })
}

/// Accepts `candidate` only if it is a PNG written by Snap2Link into
/// `captures_dir`. Anything else (another folder, `..` tricks, a symlink
/// pointing outside, a renamed non-PNG) is rejected.
pub fn resolve_capture_path_in(captures_dir: &Path, candidate: &str) -> Result<PathBuf, String> {
    let rejected = || "path is not a Snap2Link capture".to_string();
    let canon_dir = captures_dir.canonicalize().map_err(|_| rejected())?;
    let canon = Path::new(candidate).canonicalize().map_err(|_| rejected())?;
    if canon.parent() != Some(canon_dir.as_path()) {
        return Err(rejected());
    }
    let name = canon.file_name().and_then(|n| n.to_str()).ok_or_else(rejected)?;
    if !is_capture_file_name(name) || !canon.is_file() {
        return Err(rejected());
    }
    let mut head = [0u8; PNG_MAGIC.len()];
    fs::File::open(&canon)
        .and_then(|mut f| f.read_exact(&mut head))
        .map_err(|_| rejected())?;
    if !is_png(&head) {
        return Err(rejected());
    }
    Ok(canon)
}

pub fn resolve_capture_path(app: &AppHandle, candidate: &str) -> Result<PathBuf, String> {
    resolve_capture_path_in(&captures_dir(app)?, candidate)
}

pub fn purge_captures_in(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_str().map(is_capture_file_name).unwrap_or(false) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Pipe a frontend log line into the dev terminal — useful for windows that
/// disappear before you can open their DevTools (e.g. the overlay).
#[tauri::command]
pub fn debug_log(message: String) {
    let capped: String = message.chars().take(2000).collect();
    eprintln!("[frontend] {capped}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];

    fn captures() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join(CAPTURES_SUBDIR);
        ensure_private_dir(&dir).unwrap();
        (tmp, dir)
    }

    #[test]
    fn capture_file_names() {
        assert!(is_capture_file_name("cap-123.png"));
        assert!(is_capture_file_name("annotated-9.png"));
        assert!(!is_capture_file_name("cap-.png"));
        assert!(!is_capture_file_name("cap-12a.png"));
        assert!(!is_capture_file_name("token.json"));
        assert!(!is_capture_file_name("cap-1.png.exe"));
    }

    #[test]
    fn accepts_real_capture() {
        let (_tmp, dir) = captures();
        let p = new_capture_path(&dir, "cap-");
        write_capture_file(&p, PNG).unwrap();
        let resolved = resolve_capture_path_in(&dir, p.to_str().unwrap()).unwrap();
        assert_eq!(resolved, p.canonicalize().unwrap());
    }

    #[test]
    fn rejects_file_outside_captures_dir() {
        let (tmp, dir) = captures();
        let outside = tmp.path().join("cap-1.png");
        fs::write(&outside, PNG).unwrap();
        assert!(resolve_capture_path_in(&dir, outside.to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_parent_traversal() {
        let (tmp, dir) = captures();
        fs::write(tmp.path().join("cap-2.png"), PNG).unwrap();
        let sneaky = dir.join("..").join("cap-2.png");
        assert!(resolve_capture_path_in(&dir, sneaky.to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_wrong_name_and_non_png() {
        let (_tmp, dir) = captures();
        let token = dir.join("token.json");
        fs::write(&token, PNG).unwrap();
        assert!(resolve_capture_path_in(&dir, token.to_str().unwrap()).is_err());

        let fake = dir.join("cap-3.png");
        fs::write(&fake, b"not a png at all").unwrap();
        assert!(resolve_capture_path_in(&dir, fake.to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_missing_file() {
        let (_tmp, dir) = captures();
        let p = dir.join("cap-4.png");
        assert!(resolve_capture_path_in(&dir, p.to_str().unwrap()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escaping_captures_dir() {
        let (tmp, dir) = captures();
        let secret = tmp.path().join("secret.png");
        fs::write(&secret, PNG).unwrap();
        let link = dir.join("cap-5.png");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        assert!(resolve_capture_path_in(&dir, link.to_str().unwrap()).is_err());
    }

    #[test]
    fn write_capture_file_refuses_existing_path() {
        let (_tmp, dir) = captures();
        let p = dir.join("cap-6.png");
        fs::write(&p, PNG).unwrap();
        assert!(write_capture_file(&p, PNG).is_err());
    }

    #[test]
    fn write_private_file_replaces_content() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("token.json");
        write_private_file(&p, b"one").unwrap();
        write_private_file(&p, b"two").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn purge_only_removes_captures() {
        let (_tmp, dir) = captures();
        fs::write(dir.join("cap-7.png"), PNG).unwrap();
        fs::write(dir.join("keep.txt"), b"x").unwrap();
        purge_captures_in(&dir);
        assert!(!dir.join("cap-7.png").exists());
        assert!(dir.join("keep.txt").exists());
    }
}
