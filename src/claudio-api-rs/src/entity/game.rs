use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "games")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub title: String,
    pub platform: String,
    pub folder_name: String,
    pub folder_path: String,
    pub install_type: String,
    pub summary: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub cover_url: Option<String>,
    pub hero_url: Option<String>,
    pub igdb_id: Option<i64>,
    pub igdb_slug: Option<String>,
    pub size_bytes: i64,
    pub is_missing: bool,
    pub installer_exe: Option<String>,
    pub game_exe: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub game_mode: Option<String>,
    pub series: Option<String>,
    pub franchise: Option<String>,
    pub game_engine: Option<String>,
    pub is_processing: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
