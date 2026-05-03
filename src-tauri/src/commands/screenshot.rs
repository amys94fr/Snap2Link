//! Region screenshot capture using the `xcap` crate.

use xcap::Monitor;

#[tauri::command]
pub fn capture_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    capture_region_inner(x, y, width, height).map_err(|e| e.to_string())
}

pub fn capture_region_inner(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> anyhow::Result<String> {
    let monitors = Monitor::all()?;
    if monitors.is_empty() {
        anyhow::bail!("No monitor available");
    }

    // Pick the monitor that contains the top-left corner of the requested
    // region; otherwise, the primary one.
    let monitor = monitors
        .iter()
        .find(|m| {
            let mx = m.x();
            let my = m.y();
            let mw = m.width() as i32;
            let mh = m.height() as i32;
            x >= mx && y >= my && x < mx + mw && y < my + mh
        })
        .or_else(|| monitors.first())
        .unwrap();

    // Translate global coords to monitor-local coords.
    let local_x = (x - monitor.x()).max(0) as u32;
    let local_y = (y - monitor.y()).max(0) as u32;

    let image = monitor.capture_image()?;
    let cropped = image::imageops::crop_imm(&image, local_x, local_y, width, height).to_image();

    let tmp = std::env::temp_dir().join("snap2link_cap.png");
    cropped.save(&tmp)?;
    Ok(tmp.to_string_lossy().to_string())
}
