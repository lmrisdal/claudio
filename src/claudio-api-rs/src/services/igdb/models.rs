use chrono::Datelike;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskStatus {
    pub is_running: bool,
    pub current_game: Option<String>,
    pub total: usize,
    pub processed: usize,
    pub matched: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IgdbCandidate {
    pub igdb_id: i64,
    pub name: String,
    pub slug: Option<String>,
    pub summary: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub cover_url: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub game_mode: Option<String>,
    pub series: Option<String>,
    pub franchise: Option<String>,
    pub game_engine: Option<String>,
    pub platform: Option<String>,
    pub platform_slug: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct TwitchTokenResponse {
    pub(super) access_token: String,
    pub(super) expires_in: u32,
}

#[derive(Debug, Deserialize)]
pub(super) struct IgdbGame {
    pub(super) id: i64,
    pub(super) name: Option<String>,
    pub(super) slug: Option<String>,
    pub(super) summary: Option<String>,
    pub(super) genres: Option<Vec<IgdbNamedEntity>>,
    pub(super) first_release_date: Option<i64>,
    pub(super) cover: Option<IgdbCover>,
    pub(super) involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    pub(super) game_modes: Option<Vec<IgdbNamedEntity>>,
    pub(super) collection: Option<IgdbNamedEntity>,
    pub(super) franchises: Option<Vec<IgdbNamedEntity>>,
    pub(super) game_engines: Option<Vec<IgdbNamedEntity>>,
    pub(super) platforms: Option<Vec<IgdbNamedEntity>>,
}

impl IgdbGame {
    pub(super) fn into_candidate(self) -> IgdbCandidate {
        let cover_url = self.cover.and_then(|cover| {
            cover.image_id.map(|image_id| {
                format!("https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg")
            })
        });
        let genre = join_named_entities(self.genres.as_deref());
        let release_year = self
            .first_release_date
            .and_then(|timestamp| chrono::DateTime::from_timestamp(timestamp, 0))
            .map(|value| value.year());
        let (developer, publisher) = company_names(self.involved_companies.as_deref());
        let game_mode = join_named_entities(self.game_modes.as_deref());
        let series = self.collection.map(|collection| collection.name);
        let franchise = join_named_entities(self.franchises.as_deref());
        let game_engine = join_named_entities(self.game_engines.as_deref());
        let platform = join_named_entities(self.platforms.as_deref());
        let platform_slug = self
            .platforms
            .as_deref()
            .map(join_slugs)
            .filter(|value| !value.is_empty());

        IgdbCandidate {
            igdb_id: self.id,
            name: self.name.unwrap_or_default(),
            slug: self.slug,
            summary: self.summary,
            genre,
            release_year,
            cover_url,
            developer,
            publisher,
            game_mode,
            series,
            franchise,
            game_engine,
            platform,
            platform_slug,
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct IgdbNamedEntity {
    pub(super) name: String,
    pub(super) slug: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct IgdbCover {
    pub(super) image_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct IgdbInvolvedCompany {
    pub(super) company: Option<IgdbNamedEntity>,
    pub(super) developer: bool,
    pub(super) publisher: bool,
}

fn join_named_entities(values: Option<&[IgdbNamedEntity]>) -> Option<String> {
    let joined = values
        .unwrap_or_default()
        .iter()
        .map(|value| value.name.as_str())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    (!joined.is_empty()).then_some(joined)
}

fn join_slugs(values: &[IgdbNamedEntity]) -> String {
    values
        .iter()
        .filter_map(|value| value.slug.as_deref())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn company_names(values: Option<&[IgdbInvolvedCompany]>) -> (Option<String>, Option<String>) {
    let developers = values
        .unwrap_or_default()
        .iter()
        .filter(|value| value.developer)
        .filter_map(|value| value.company.as_ref().map(|company| company.name.as_str()))
        .collect::<Vec<_>>()
        .join(", ");
    let publishers = values
        .unwrap_or_default()
        .iter()
        .filter(|value| value.publisher)
        .filter_map(|value| value.company.as_ref().map(|company| company.name.as_str()))
        .collect::<Vec<_>>()
        .join(", ");

    (
        (!developers.is_empty()).then_some(developers),
        (!publishers.is_empty()).then_some(publishers),
    )
}
