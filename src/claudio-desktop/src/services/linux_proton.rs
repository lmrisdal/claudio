#![cfg_attr(test, allow(dead_code))]

use crate::settings;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtonVersionOption {
    pub label: String,
    pub value: String,
}

pub fn list_proton_versions() -> Vec<ProtonVersionOption> {
    let mut versions = vec![
        ProtonVersionOption {
            label: "UMU Latest".to_string(),
            value: "UMU-Latest".to_string(),
        },
        ProtonVersionOption {
            label: "GE-Proton Latest".to_string(),
            value: "GE-Proton".to_string(),
        },
        ProtonVersionOption {
            label: "GE Latest".to_string(),
            value: "GE-Latest".to_string(),
        },
        ProtonVersionOption {
            label: "UMU Sniper".to_string(),
            value: "umu-sniper".to_string(),
        },
    ];

    for dir in compatibility_tool_dirs() {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !is_compatible_proton_tool(&path) {
                    continue;
                }
                let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                let value = path.to_string_lossy().into_owned();
                if versions
                    .iter()
                    .any(|version| version.value == value || version.label == name)
                {
                    continue;
                }
                versions.push(ProtonVersionOption {
                    label: name.to_string(),
                    value,
                });
            }
        }
    }

    versions
}

pub fn selected_proton_path(requested: Option<&str>) -> String {
    let requested = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| settings::resolve_proton_path(&settings::load()));

    if is_builtin_proton_option(&requested) || is_compatible_proton_tool(Path::new(&requested)) {
        return requested;
    }

    log::warn!(
        "[umu] ignoring incompatible Proton selection '{requested}', falling back to UMU-Latest"
    );
    settings::default_proton_path()
}

fn is_builtin_proton_option(value: &str) -> bool {
    matches!(
        value,
        "UMU-Latest"
            | "GE-Proton"
            | "GE-Latest"
            | "UMU-Proton"
            | "umu-scout"
            | "umu-soldier"
            | "umu-sniper"
            | "umu-steamrt4"
            | "umu-steamrt4-arm64"
    )
}

fn is_compatible_proton_tool(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    let Ok(toolmanifest) = fs::read_to_string(path.join("toolmanifest.vdf")) else {
        return false;
    };
    if !toolmanifest_contains_proton(&toolmanifest) {
        return false;
    }

    let Ok(compatibilitytool) = fs::read_to_string(path.join("compatibilitytool.vdf")) else {
        return false;
    };
    compatibilitytool.contains("\"from_oslist\"")
        && compatibilitytool.contains("\"windows\"")
        && compatibilitytool.contains("\"to_oslist\"")
        && compatibilitytool.contains("\"linux\"")
}

fn toolmanifest_contains_proton(contents: &str) -> bool {
    contents.contains("\"compatmanager_layer_name\"")
        && contents.contains("\"proton\"")
        && contents.contains("\"commandline\"")
        && contents.contains("/proton")
}

fn compatibility_tool_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(data_dir) = dirs::data_dir() {
        dirs.push(data_dir.join("Steam").join("compatibilitytools.d"));
        dirs.push(data_dir.join("umu").join("compatibilitytools"));
    }
    dirs
}
