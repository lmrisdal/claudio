use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub username: String,
    pub password_hash: Option<String>,
    pub email: Option<String>,
    pub role: String,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::refresh_token::Entity")]
    RefreshTokens,
    #[sea_orm(has_many = "super::user_external_login::Entity")]
    ExternalLogins,
}

impl Related<super::refresh_token::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RefreshTokens.def()
    }
}

impl Related<super::user_external_login::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ExternalLogins.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
