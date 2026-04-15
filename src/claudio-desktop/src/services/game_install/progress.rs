use super::*;

pub(super) fn emit_progress(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
) {
    emit_progress_with_bytes(
        app,
        InstallProgress {
            game_id,
            status: status.to_string(),
            percent,
            indeterminate: None,
            detail: detail.map(ToString::to_string),
            bytes_downloaded: None,
            total_bytes: None,
        },
    );
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
        InstallProgress {
            game_id,
            status: status.to_string(),
            percent,
            indeterminate: Some(indeterminate),
            detail: detail.map(ToString::to_string),
            bytes_downloaded: None,
            total_bytes: None,
        },
    );
}

pub(super) fn emit_progress_with_bytes(app: &AppHandle, progress: InstallProgress) {
    emit_progress_with_bytes_to(
        &mut |progress| {
            let _ = app.emit("install-progress", progress);
        },
        progress,
    );
}

pub(super) fn emit_progress_with_bytes_to<F>(on_progress: &mut F, progress: InstallProgress)
where
    F: FnMut(InstallProgress),
{
    on_progress(progress);
}

pub(super) fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
