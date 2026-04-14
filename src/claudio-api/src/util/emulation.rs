use crate::{
    entity::game,
    util::{archive, file_browse},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulationInfoResponse {
    pub supported: bool,
    pub core: Option<String>,
    pub requires_threads: bool,
    pub reason: Option<String>,
    pub preferred_path: Option<String>,
    pub candidates: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct EmulationSessionRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct EmulationSessionResponse {
    pub ticket: String,
    #[serde(rename = "gameUrl")]
    pub game_url: String,
}

pub fn build_info(game: &game::Model) -> EmulationInfoResponse {
    if !file_browse::exists_on_disk(game) {
        return EmulationInfoResponse {
            supported: false,
            core: None,
            requires_threads: false,
            reason: Some("Game files are missing from disk.".to_string()),
            preferred_path: None,
            candidates: Vec::new(),
        };
    }

    let Some(definition) = definition_for(&game.platform) else {
        return EmulationInfoResponse {
            supported: false,
            core: None,
            requires_threads: false,
            reason: Some(format!(
                "Platform '{}' is not mapped to an EmulatorJS core yet.",
                game.platform
            )),
            preferred_path: None,
            candidates: Vec::new(),
        };
    };

    let candidates = find_candidates(game, &definition);
    if candidates.is_empty() {
        return EmulationInfoResponse {
            supported: false,
            core: Some(definition.core.to_string()),
            requires_threads: definition.requires_threads,
            reason: Some("No supported ROM files were found for this game.".to_string()),
            preferred_path: None,
            candidates,
        };
    }

    EmulationInfoResponse {
        supported: true,
        core: Some(definition.core.to_string()),
        requires_threads: definition.requires_threads,
        reason: None,
        preferred_path: candidates.first().cloned(),
        candidates,
    }
}

fn find_candidates(game: &game::Model, definition: &EmulationPlatformDefinition) -> Vec<String> {
    let mut candidates = Vec::new();

    if file_browse::is_standalone_archive(game) {
        let extension = archive::full_extension(&game.folder_path);
        if definition
            .extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
        {
            if let Some(file_name) = std::path::Path::new(&game.folder_path).file_name() {
                candidates.push(file_name.to_string_lossy().to_string());
            }
        }

        return order_candidates(candidates, definition);
    }

    if let Some(archive_path) =
        file_browse::find_single_archive(std::path::Path::new(&game.folder_path))
    {
        let extension = archive::full_extension(&archive_path.to_string_lossy());
        if definition
            .extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
        {
            if let Some(file_name) = archive_path.file_name() {
                candidates.push(file_name.to_string_lossy().to_string());
            }
        }

        return order_candidates(candidates, definition);
    }

    let Ok(files) = file_browse::list_relative_files(game) else {
        return Vec::new();
    };

    candidates.extend(files.into_iter().filter(|path| {
        let extension = archive::full_extension(path);
        definition
            .extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
    }));

    order_candidates(candidates, definition)
}

fn order_candidates(
    mut candidates: Vec<String>,
    definition: &EmulationPlatformDefinition,
) -> Vec<String> {
    candidates.sort_unstable_by(|left, right| {
        preferred_extension_index(left, definition)
            .cmp(&preferred_extension_index(right, definition))
            .then_with(|| left.matches('/').count().cmp(&right.matches('/').count()))
            .then_with(|| left.len().cmp(&right.len()))
            .then_with(|| left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase()))
    });
    candidates.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    candidates
}

fn preferred_extension_index(path: &str, definition: &EmulationPlatformDefinition) -> usize {
    let extension = archive::full_extension(path);
    definition
        .preferred_extensions
        .iter()
        .position(|candidate| candidate.eq_ignore_ascii_case(&extension))
        .unwrap_or(usize::MAX)
}

struct EmulationPlatformDefinition {
    core: &'static str,
    requires_threads: bool,
    extensions: &'static [&'static str],
    preferred_extensions: &'static [&'static str],
}

fn definition_for(platform: &str) -> Option<EmulationPlatformDefinition> {
    match platform.to_ascii_lowercase().as_str() {
        "gb" => Some(EmulationPlatformDefinition {
            core: "gb",
            requires_threads: false,
            extensions: &[".gb", ".gbc", ".zip"],
            preferred_extensions: &[".gbc", ".gb", ".zip"],
        }),
        "gbc" => Some(EmulationPlatformDefinition {
            core: "gb",
            requires_threads: false,
            extensions: &[".gbc", ".gb", ".zip"],
            preferred_extensions: &[".gbc", ".gb", ".zip"],
        }),
        "gba" => Some(EmulationPlatformDefinition {
            core: "gba",
            requires_threads: false,
            extensions: &[".gba", ".zip"],
            preferred_extensions: &[".gba", ".zip"],
        }),
        "nes" => Some(EmulationPlatformDefinition {
            core: "nes",
            requires_threads: false,
            extensions: &[".nes", ".fds", ".unf", ".unif", ".zip"],
            preferred_extensions: &[".nes", ".fds", ".unif", ".unf", ".zip"],
        }),
        "snes" => Some(EmulationPlatformDefinition {
            core: "snes",
            requires_threads: false,
            extensions: &[".sfc", ".smc", ".fig", ".bs", ".st", ".zip"],
            preferred_extensions: &[".sfc", ".smc", ".fig", ".bs", ".st", ".zip"],
        }),
        "n64" => Some(EmulationPlatformDefinition {
            core: "n64",
            requires_threads: false,
            extensions: &[".z64", ".n64", ".v64", ".zip"],
            preferred_extensions: &[".z64", ".n64", ".v64", ".zip"],
        }),
        "ds" => Some(EmulationPlatformDefinition {
            core: "nds",
            requires_threads: false,
            extensions: &[".nds", ".zip"],
            preferred_extensions: &[".nds", ".zip"],
        }),
        "ps1" => Some(EmulationPlatformDefinition {
            core: "psx",
            requires_threads: false,
            extensions: &[
                ".chd", ".cue", ".pbp", ".m3u", ".ccd", ".iso", ".bin", ".zip",
            ],
            preferred_extensions: &[
                ".chd", ".cue", ".pbp", ".m3u", ".ccd", ".iso", ".zip", ".bin",
            ],
        }),
        "psp" => Some(EmulationPlatformDefinition {
            core: "psp",
            requires_threads: true,
            extensions: &[".iso", ".cso", ".pbp", ".zip"],
            preferred_extensions: &[".iso", ".cso", ".pbp", ".zip"],
        }),
        "genesis" => Some(EmulationPlatformDefinition {
            core: "segaMD",
            requires_threads: false,
            extensions: &[".md", ".gen", ".bin", ".smd", ".zip"],
            preferred_extensions: &[".md", ".gen", ".bin", ".smd", ".zip"],
        }),
        "saturn" => Some(EmulationPlatformDefinition {
            core: "segaSaturn",
            requires_threads: false,
            extensions: &[".chd", ".cue", ".m3u", ".iso", ".zip"],
            preferred_extensions: &[".chd", ".cue", ".m3u", ".iso", ".zip"],
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{build_info, EmulationInfoResponse};
    use crate::entity::game;

    #[test]
    fn unsupported_platform_returns_reason() {
        let game = game::Model {
            id: 1,
            title: "Test".to_string(),
            platform: "win".to_string(),
            folder_name: "Test".to_string(),
            folder_path: "/definitely/missing".to_string(),
            install_type: "portable".to_string(),
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            igdb_id: None,
            igdb_slug: None,
            size_bytes: 0,
            is_missing: false,
            installer_exe: None,
            game_exe: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
            is_processing: false,
        };

        let info: EmulationInfoResponse = build_info(&game);
        assert!(!info.supported);
        assert!(info.reason.is_some());
    }

    #[test]
    fn supported_platform_prefers_better_extension() {
        let temp_root = std::env::temp_dir().join(format!(
            "claudio-api-emulation-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_root).unwrap();
        fs::write(temp_root.join("game.bin"), b"hello").unwrap();
        fs::write(temp_root.join("game.iso"), b"hello").unwrap();

        let game = game::Model {
            id: 1,
            title: "Test".to_string(),
            platform: "ps1".to_string(),
            folder_name: "Test".to_string(),
            folder_path: temp_root.to_string_lossy().to_string(),
            install_type: "portable".to_string(),
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            igdb_id: None,
            igdb_slug: None,
            size_bytes: 0,
            is_missing: false,
            installer_exe: None,
            game_exe: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
            is_processing: false,
        };

        let info = build_info(&game);
        assert!(info.supported);
        assert_eq!(info.preferred_path.as_deref(), Some("game.iso"));

        fs::remove_dir_all(temp_root).unwrap();
    }
}
