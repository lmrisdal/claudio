use super::*;

pub(super) fn normalize_into_final_dir(
    staging_root: &Path,
    final_dir: &Path,
) -> Result<(), String> {
    let entries = visible_entries(staging_root)?;

    if entries.len() == 1 && entries[0].is_dir() {
        fs::rename(&entries[0], final_dir).map_err(|err| {
            log_io_failure_pair(
                "move extracted root directory",
                &entries[0],
                final_dir,
                &err,
            );
            format_install_io_error_pair("move extracted files", &entries[0], final_dir, &err)
        })?;
        fs::remove_dir_all(staging_root).map_err(|err| {
            log_io_failure("remove extraction staging root", staging_root, &err);
            format_install_io_error("clean the extraction staging folder", staging_root, &err)
        })?;
        return Ok(());
    }

    fs::create_dir_all(final_dir).map_err(|err| {
        log_io_failure("create final install directory", final_dir, &err);
        format_install_io_error("create the install folder", final_dir, &err)
    })?;
    for entry in entries {
        let target = final_dir.join(
            entry
                .file_name()
                .ok_or_else(|| "Extracted entry was missing a file name.".to_string())?,
        );
        fs::rename(&entry, &target).map_err(|err| {
            log_io_failure_pair(
                "move extracted entry into final directory",
                &entry,
                &target,
                &err,
            );
            format_install_io_error_pair("move extracted files", &entry, &target, &err)
        })?;
    }

    fs::remove_dir_all(staging_root).map_err(|err| {
        log_io_failure("remove extraction staging root", staging_root, &err);
        format_install_io_error("clean the extraction staging folder", staging_root, &err)
    })
}

pub(super) fn clear_existing_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|err| {
            log_io_failure("remove existing directory before replacement", path, &err);
            format_install_io_error("remove the existing destination directory", path, &err)
        })?;
    } else {
        fs::remove_file(path).map_err(|err| {
            log_io_failure("remove existing file before replacement", path, &err);
            format_install_io_error("remove the existing destination file", path, &err)
        })?;
    }

    Ok(())
}

pub(super) fn move_visible_entries_into_dir(
    source_root: &Path,
    destination_dir: &Path,
) -> Result<Vec<PathBuf>, String> {
    let entries = visible_entries(source_root)?;
    let move_source = if entries.len() == 1 && entries[0].is_dir() {
        entries[0].clone()
    } else {
        source_root.to_path_buf()
    };

    let mut moved = Vec::new();
    for entry in visible_entries(&move_source)? {
        let target = destination_dir.join(
            entry
                .file_name()
                .ok_or_else(|| "Extracted entry was missing a file name.".to_string())?,
        );
        clear_existing_path(&target)?;
        fs::rename(&entry, &target).map_err(|err| {
            log_io_failure_pair(
                "move extracted entry into destination directory",
                &entry,
                &target,
                &err,
            );
            format_install_io_error_pair(
                "move the extracted entry into the destination directory",
                &entry,
                &target,
                &err,
            )
        })?;
        moved.push(target);
    }

    Ok(moved)
}

pub(super) fn visible_entries(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|err| {
        log_io_failure("read directory entries", root, &err);
        format_install_io_error("read the directory entries", root, &err)
    })? {
        let entry = entry.map_err(|err| {
            log_io_failure("read directory entry", root, &err);
            format_install_io_error("read the directory entries", root, &err)
        })?;
        let path = entry.path();
        let hidden = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == "__MACOSX" || name == ".DS_Store")
            .unwrap_or(false);
        if !hidden {
            entries.push(path);
        }
    }
    Ok(entries)
}

const SCENE_GROUP_FOLDERS: &[&str] = &[
    "skidrow",
    "codex",
    "cpy",
    "plaza",
    "reloaded",
    "rune",
    "empress",
    "voksi",
    "flt",
    "bat",
    "prophet",
    "darksiders",
    "dodi",
    "hoodlum",
    "razor1911",
    "fairlight",
    "voices38",
    "crack",
    "kirigiri",
];

pub(super) fn apply_scene_overrides(source_dir: &Path, target_dir: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(source_dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if SCENE_GROUP_FOLDERS
            .iter()
            .any(|g| g.eq_ignore_ascii_case(name))
        {
            log::info!(
                "Applying scene group overrides from '{}' to {}",
                name,
                target_dir.display()
            );
            copy_dir_contents(&path, target_dir)?;
        }
    }
    Ok(())
}

pub(super) fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    let entries = fs::read_dir(src).map_err(|error| {
        log_io_failure("read directory contents for copy", src, &error);
        format_install_io_error("read the source directory", src, &error)
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            log_io_failure("read directory entry for copy", src, &error);
            format_install_io_error("read the source directory", src, &error)
        })?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|error| {
                log_io_failure(
                    "create destination directory during copy",
                    &dst_path,
                    &error,
                );
                format_install_io_error("create the install folder", &dst_path, &error)
            })?;
            copy_dir_contents(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|error| {
                log_io_failure_pair(
                    "copy file into destination directory",
                    &src_path,
                    &dst_path,
                    &error,
                );
                format_install_io_error_pair("copy extracted files", &src_path, &dst_path, &error)
            })?;
        }
    }
    Ok(())
}

pub(super) fn collect_matching_files<F>(root: &Path, matches: &mut Vec<PathBuf>, predicate: F)
where
    F: Copy + Fn(&Path) -> bool,
{
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_matching_files(&path, matches, predicate);
            } else if predicate(&path) {
                matches.push(path);
            }
        }
    }
}

pub(crate) fn sanitize_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect();

    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        "game".to_string()
    } else {
        trimmed.to_string()
    }
}
