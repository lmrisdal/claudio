pub mod github;
pub mod google;
pub mod oidc;
pub mod state_store;

pub use state_store::OAuthStateStore;

use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
};
use thiserror::Error;

const MAX_USERNAME_ATTEMPTS: u32 = 10;

use crate::entity::{user, user_external_login};

#[derive(Debug, Error)]
pub enum OAuthError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("missing required field: {0}")]
    MissingField(&'static str),
}

pub struct ExternalUserInfo {
    pub provider_key: String,
    pub username: Option<String>,
    pub email: Option<String>,
    pub email_verified: bool,
}

pub async fn find_or_create_user(
    db: &sea_orm::DatabaseConnection,
    provider: &str,
    info: &ExternalUserInfo,
) -> Result<i32, OAuthError> {
    let existing_login = user_external_login::Entity::find()
        .filter(user_external_login::Column::Provider.eq(provider))
        .filter(user_external_login::Column::ProviderKey.eq(&info.provider_key))
        .one(db)
        .await?;

    if let Some(login) = existing_login {
        return Ok(login.user_id);
    }

    if info.email_verified {
        if let Some(ref email) = info.email {
            let user_by_email = user::Entity::find()
                .filter(user::Column::Email.eq(email.as_str()))
                .one(db)
                .await?;

            if let Some(u) = user_by_email {
                user_external_login::ActiveModel {
                    user_id: ActiveValue::Set(u.id),
                    provider: ActiveValue::Set(provider.to_string()),
                    provider_key: ActiveValue::Set(info.provider_key.clone()),
                    ..Default::default()
                }
                .insert(db)
                .await?;
                return Ok(u.id);
            }
        }
    }

    let count = user::Entity::find().count(db).await?;
    let role = if count == 0 { "admin" } else { "user" };

    let base_username = info
        .username
        .as_deref()
        .or_else(|| info.email.as_deref().and_then(|e| e.split('@').next()))
        .unwrap_or(provider);

    let username = unique_username(db, base_username).await?;

    let now = chrono::Utc::now().fixed_offset();

    let inserted = user::ActiveModel {
        username: ActiveValue::Set(username),
        password_hash: ActiveValue::Set(None),
        email: ActiveValue::Set(info.email.clone()),
        role: ActiveValue::Set(role.to_string()),
        created_at: ActiveValue::Set(now),
        ..Default::default()
    }
    .insert(db)
    .await?;

    user_external_login::ActiveModel {
        user_id: ActiveValue::Set(inserted.id),
        provider: ActiveValue::Set(provider.to_string()),
        provider_key: ActiveValue::Set(info.provider_key.clone()),
        ..Default::default()
    }
    .insert(db)
    .await?;

    tracing::info!(
        provider,
        username = %inserted.username,
        "new user created via OAuth"
    );

    Ok(inserted.id)
}

async fn unique_username(
    db: &sea_orm::DatabaseConnection,
    base: &str,
) -> Result<String, OAuthError> {
    if user::Entity::find()
        .filter(user::Column::Username.eq(base))
        .one(db)
        .await?
        .is_none()
    {
        return Ok(base.to_owned());
    }

    for _ in 0..MAX_USERNAME_ATTEMPTS {
        let suffix = rand_core::RngCore::next_u32(&mut rand_core::OsRng) % 9000 + 1000;
        let candidate = format!("{base}_{suffix}");

        if user::Entity::find()
            .filter(user::Column::Username.eq(&candidate))
            .one(db)
            .await?
            .is_none()
        {
            return Ok(candidate);
        }
    }

    Err(OAuthError::Provider(format!(
        "could not generate a unique username for '{base}'"
    )))
}
