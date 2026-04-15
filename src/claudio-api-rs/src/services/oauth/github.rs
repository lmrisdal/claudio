use oauth2::{
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, RedirectUrl,
    Scope, TokenResponse, TokenUrl,
};
use serde::Deserialize;

use crate::config::GitHubOAuthConfig;

use super::{ExternalUserInfo, OAuthError};

const AUTH_URL: &str = "https://github.com/login/oauth/authorize";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const USER_URL: &str = "https://api.github.com/user";
const EMAILS_URL: &str = "https://api.github.com/user/emails";

pub fn build_auth_url(config: &GitHubOAuthConfig, state: &str) -> String {
    let state = state.to_string();
    let (url, _) = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_client_secret(ClientSecret::new(config.client_secret.clone()))
        .set_auth_uri(AuthUrl::new(AUTH_URL.to_string()).expect("GitHub auth URL is valid"))
        .set_token_uri(TokenUrl::new(TOKEN_URL.to_string()).expect("GitHub token URL is valid"))
        .set_redirect_uri(
            RedirectUrl::new(config.redirect_uri.clone()).expect("redirect URI from config"),
        )
        .authorize_url(move || CsrfToken::new(state))
        .add_scope(Scope::new("read:user".to_string()))
        .add_scope(Scope::new("user:email".to_string()))
        .url();
    url.to_string()
}

pub async fn exchange_code(
    config: &GitHubOAuthConfig,
    http_client: &reqwest::Client,
    code: &str,
) -> Result<ExternalUserInfo, OAuthError> {
    let token_response = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_client_secret(ClientSecret::new(config.client_secret.clone()))
        .set_auth_uri(AuthUrl::new(AUTH_URL.to_string()).expect("GitHub auth URL is valid"))
        .set_token_uri(TokenUrl::new(TOKEN_URL.to_string()).expect("GitHub token URL is valid"))
        .set_redirect_uri(
            RedirectUrl::new(config.redirect_uri.clone()).expect("redirect URI from config"),
        )
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .request_async(http_client)
        .await
        .map_err(|e| OAuthError::Provider(e.to_string()))?;

    let token = token_response.access_token().secret();
    let user = fetch_user(http_client, token).await?;
    let email = fetch_primary_email(http_client, token).await?;

    Ok(ExternalUserInfo {
        provider_key: user.id.to_string(),
        username: Some(user.login),
        email: email.as_ref().map(|(addr, _)| addr.clone()),
        email_verified: email.map(|(_, verified)| verified).unwrap_or(false),
    })
}

#[derive(Deserialize)]
struct GitHubUser {
    id: u64,
    login: String,
}

#[derive(Deserialize)]
struct GitHubEmail {
    email: String,
    primary: bool,
    verified: bool,
}

async fn fetch_user(http_client: &reqwest::Client, token: &str) -> Result<GitHubUser, OAuthError> {
    let user = http_client
        .get(USER_URL)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    Ok(user)
}

async fn fetch_primary_email(
    http_client: &reqwest::Client,
    token: &str,
) -> Result<Option<(String, bool)>, OAuthError> {
    let emails: Vec<GitHubEmail> = http_client
        .get(EMAILS_URL)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let primary = emails
        .into_iter()
        .find(|e| e.primary)
        .map(|e| (e.email, e.verified));

    Ok(primary)
}
