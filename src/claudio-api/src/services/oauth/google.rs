use oauth2::{
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, RedirectUrl,
    Scope, TokenResponse, TokenUrl,
};
use serde::Deserialize;

use crate::config::GoogleOAuthConfig;

use super::{ExternalUserInfo, OAuthError};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";

pub fn build_auth_url(config: &GoogleOAuthConfig, state: &str) -> String {
    let state = state.to_string();
    let (url, _) = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_client_secret(ClientSecret::new(config.client_secret.clone()))
        .set_auth_uri(AuthUrl::new(AUTH_URL.to_string()).expect("Google auth URL is valid"))
        .set_token_uri(TokenUrl::new(TOKEN_URL.to_string()).expect("Google token URL is valid"))
        .set_redirect_uri(
            RedirectUrl::new(config.redirect_uri.clone()).expect("redirect URI from config"),
        )
        .authorize_url(move || CsrfToken::new(state))
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .url();
    url.to_string()
}

pub async fn exchange_code(
    config: &GoogleOAuthConfig,
    http_client: &reqwest::Client,
    code: &str,
) -> Result<ExternalUserInfo, OAuthError> {
    let token_response = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_client_secret(ClientSecret::new(config.client_secret.clone()))
        .set_auth_uri(AuthUrl::new(AUTH_URL.to_string()).expect("Google auth URL is valid"))
        .set_token_uri(TokenUrl::new(TOKEN_URL.to_string()).expect("Google token URL is valid"))
        .set_redirect_uri(
            RedirectUrl::new(config.redirect_uri.clone()).expect("redirect URI from config"),
        )
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .request_async(http_client)
        .await
        .map_err(|e| OAuthError::Provider(e.to_string()))?;

    let token = token_response.access_token().secret();
    let user = fetch_userinfo(http_client, token).await?;

    Ok(ExternalUserInfo {
        provider_key: user.sub,
        username: None,
        email: Some(user.email),
        email_verified: user.email_verified,
    })
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    sub: String,
    email: String,
    #[serde(default)]
    email_verified: bool,
}

async fn fetch_userinfo(
    http_client: &reqwest::Client,
    token: &str,
) -> Result<GoogleUserInfo, OAuthError> {
    let user = http_client
        .get(USERINFO_URL)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    Ok(user)
}
