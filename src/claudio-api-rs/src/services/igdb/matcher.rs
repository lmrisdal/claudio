use sea_orm::ActiveValue::Set;

use crate::{entity::game, util::archive};

use super::models::IgdbCandidate;

pub(super) fn apply_candidate(
    game_model: game::Model,
    candidate: &IgdbCandidate,
) -> game::ActiveModel {
    let replace_cover = should_replace_cover(&game_model, candidate.igdb_id);
    let mut active_model: game::ActiveModel = game_model.into();
    active_model.title = Set(candidate.name.clone());
    if replace_cover {
        active_model.cover_url = Set(candidate.cover_url.clone());
    }
    active_model.igdb_id = Set(Some(candidate.igdb_id));
    active_model.igdb_slug = Set(candidate.slug.clone());
    active_model.summary = Set(candidate.summary.clone());
    active_model.genre = Set(candidate.genre.clone());
    active_model.release_year = Set(candidate.release_year);
    active_model.developer = Set(candidate.developer.clone());
    active_model.publisher = Set(candidate.publisher.clone());
    active_model.game_mode = Set(candidate.game_mode.clone());
    active_model.series = Set(candidate.series.clone());
    active_model.franchise = Set(candidate.franchise.clone());
    active_model.game_engine = Set(candidate.game_engine.clone());
    active_model
}

pub(super) fn select_best_candidate(
    candidates: Vec<IgdbCandidate>,
    cleaned_title: &str,
    platform: &str,
) -> Option<IgdbCandidate> {
    let expected_platform_slug = normalize_platform_slug(platform);
    candidates.into_iter().max_by_key(|candidate| {
        (
            candidate_has_platform_slug(candidate, &expected_platform_slug),
            candidate.name.eq_ignore_ascii_case(cleaned_title),
        )
    })
}

pub(super) fn parse_folder_name(name: &str) -> (String, Option<i32>, Option<i64>) {
    let mut title = strip_archive_extension(name).trim().to_string();
    let mut igdb_id = None;
    let mut year = None;

    if let Some((cleaned, parsed_igdb_id)) = strip_igdb_tag(&title) {
        title = cleaned;
        igdb_id = Some(parsed_igdb_id);
    }

    if let Some((cleaned, parsed_year)) = strip_year_tag(&title) {
        title = cleaned;
        year = Some(parsed_year);
    }

    title = strip_parenthesized_sections(&title);
    title = collapse_spaces(&title.replace(['.', '-'], " "));

    (title, year, igdb_id)
}

pub(super) fn normalize_platform_slug(platform: &str) -> String {
    if platform.eq_ignore_ascii_case("pc") {
        "win".to_string()
    } else {
        platform.trim().to_ascii_lowercase()
    }
}

fn should_replace_cover(game_model: &game::Model, new_igdb_id: i64) -> bool {
    match (&game_model.cover_url, game_model.igdb_id) {
        (None, _) => true,
        (_, Some(existing_igdb_id)) if existing_igdb_id != new_igdb_id => true,
        (Some(cover_url), _) => cover_url.starts_with("https://images.igdb.com"),
    }
}

fn candidate_has_platform_slug(candidate: &IgdbCandidate, expected_platform_slug: &str) -> bool {
    candidate
        .platform_slug
        .as_ref()
        .is_some_and(|platform_slug| {
            platform_slug
                .split(',')
                .map(str::trim)
                .any(|slug| slug.eq_ignore_ascii_case(expected_platform_slug))
        })
}

fn strip_archive_extension(name: &str) -> String {
    let extension = archive::full_extension(name);
    if extension.is_empty() {
        name.to_string()
    } else {
        name.strip_suffix(&extension).unwrap_or(name).to_string()
    }
}

fn strip_igdb_tag(name: &str) -> Option<(String, i64)> {
    let lower = name.to_ascii_lowercase();
    let tag_index = lower.find("igdb-")?;
    let digits_start = tag_index + "igdb-".len();
    let digits: String = lower[digits_start..]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }

    let number = digits.parse().ok()?;
    let mut start = tag_index;
    let mut end = digits_start + digits.len();
    let bytes = name.as_bytes();
    if start > 0 && bytes[start - 1] == b'(' && end < bytes.len() && bytes[end] == b')' {
        start -= 1;
        end += 1;
    }

    let cleaned = format!("{} {}", &name[..start], &name[end..]);
    Some((collapse_spaces(cleaned.trim()), number))
}

fn strip_year_tag(name: &str) -> Option<(String, i32)> {
    for (start, character) in name.char_indices() {
        if character != '(' {
            continue;
        }

        let remainder = &name[start..];
        if remainder.len() < 6 {
            continue;
        }

        let candidate = &remainder[..6];
        let year_digits = &candidate[1..5];
        if candidate.ends_with(')') && year_digits.chars().all(|value| value.is_ascii_digit()) {
            let year = year_digits.parse().ok()?;
            let cleaned = format!("{} {}", &name[..start], &remainder[6..]);
            return Some((collapse_spaces(cleaned.trim()), year));
        }
    }

    None
}

fn strip_parenthesized_sections(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut depth = 0usize;

    for character in name.chars() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if depth == 0 => result.push(character),
            _ => {}
        }
    }

    collapse_spaces(result.trim())
}

fn collapse_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::{normalize_platform_slug, parse_folder_name};

    #[test]
    fn parse_folder_name_should_strip_tags_and_keep_year() {
        let (title, year, igdb_id) =
            parse_folder_name("Halo.Combat.Evolved (2001) (USA) (igdb-12345).zip");

        assert_eq!(title, "Halo Combat Evolved");
        assert_eq!(year, Some(2001));
        assert_eq!(igdb_id, Some(12345));
    }

    #[test]
    fn normalize_platform_slug_should_map_pc_to_win() {
        assert_eq!(normalize_platform_slug("pc"), "win");
        assert_eq!(normalize_platform_slug("SNES"), "snes");
    }
}
