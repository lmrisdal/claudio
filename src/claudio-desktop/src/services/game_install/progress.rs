use super::*;

pub(super) fn emit_progress(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
) {
    emit_progress_with_bytes(app, game_id, status, percent, detail, None, None, None);
}

pub(super) fn emit_progress_indeterminate(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
    indeterminate: bool,
) {
    emit_progress_with_bytes(
        app,
        game_id,
        status,
        percent,
        detail,
        None,
        None,
        Some(indeterminate),
    );
}

pub(super) fn emit_progress_with_bytes(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
    bytes_downloaded: Option<u64>,
    total_bytes: Option<u64>,
    indeterminate: Option<bool>,
) {
    emit_progress_with_bytes_to(
        &mut |progress| {
            let _ = app.emit("install-progress", progress);
        },
        game_id,
        status,
        percent,
        detail,
        bytes_downloaded,
        total_bytes,
        indeterminate,
    );
}

pub(super) fn emit_progress_with_bytes_to<F>(
    on_progress: &mut F,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
    bytes_downloaded: Option<u64>,
    total_bytes: Option<u64>,
    indeterminate: Option<bool>,
) where
    F: FnMut(InstallProgress),
{
    on_progress(InstallProgress {
        game_id,
        status: status.to_string(),
        percent,
        indeterminate,
        detail: detail.map(ToString::to_string),
        bytes_downloaded,
        total_bytes,
    });
}

pub(super) fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
