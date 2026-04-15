use openidconnect::{
    core::{CoreAuthenticationFlow, CoreClient, CoreGenderClaim, CoreProviderMetadata},
    AdditionalClaims, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce,
    OAuth2TokenResponse, RedirectUrl, Scope, UserInfoClaims,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::config::OidcProviderConfig;

use super::{ExternalUserInfo, OAuthError};

/// Captures all non-standard OIDC claims alongside the standard ones.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct FlexClaims {
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}
impl AdditionalClaims for FlexClaims {}

type OidcUserInfoClaims = UserInfoClaims<FlexClaims, CoreGenderClaim>;

pub async fn build_auth_url(
    config: &OidcProviderConfig,
    http_client: &reqwest::Client,
    state: &str,
) -> Result<String, OAuthError> {
    let metadata = discover(config, http_client).await?;

    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
    )
    .set_redirect_uri(
        RedirectUrl::new(config.redirect_uri.clone())
            .map_err(|e| OAuthError::Provider(e.to_string()))?,
    );

    let state = state.to_string();
    let mut request = client.authorize_url(
        CoreAuthenticationFlow::AuthorizationCode,
        move || CsrfToken::new(state),
        Nonce::new_random,
    );

    for scope_part in config.scope.split_whitespace() {
        if scope_part != "openid" {
            request = request.add_scope(Scope::new(scope_part.to_string()));
        }
    }

    let (url, _, _) = request.url();
    Ok(url.to_string())
}

pub async fn exchange_code(
    config: &OidcProviderConfig,
    http_client: &reqwest::Client,
    code: &str,
) -> Result<ExternalUserInfo, OAuthError> {
    let metadata = discover(config, http_client).await?;

    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
    )
    .set_redirect_uri(
        RedirectUrl::new(config.redirect_uri.clone())
            .map_err(|e| OAuthError::Provider(e.to_string()))?,
    );

    let token_response = client
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .map_err(|e| OAuthError::Provider(e.to_string()))?
        .request_async(http_client)
        .await
        .map_err(|e| OAuthError::Provider(e.to_string()))?;

    let access_token = token_response.access_token().clone();

    let userinfo: OidcUserInfoClaims = client
        .user_info(access_token, None)
        .map_err(|e| OAuthError::Provider(e.to_string()))?
        .request_async(http_client)
        .await
        .map_err(|e| OAuthError::Provider(e.to_string()))?;

    let provider_key = get_claim(&userinfo, &config.user_id_claim)
        .ok_or(OAuthError::MissingField("user_id_claim"))?;

    let username = get_claim(&userinfo, &config.username_claim)
        .or_else(|| get_claim(&userinfo, "nickname"))
        .or_else(|| get_claim(&userinfo, "name"))
        .or_else(|| get_claim(&userinfo, "email"));

    let email = get_claim(&userinfo, &config.email_claim);
    let email_verified = userinfo.standard_claims().email_verified().unwrap_or(false);

    Ok(ExternalUserInfo {
        provider_key,
        username,
        email,
        email_verified,
    })
}

async fn discover(
    config: &OidcProviderConfig,
    http_client: &reqwest::Client,
) -> Result<CoreProviderMetadata, OAuthError> {
    let issuer_url = discovery_issuer_url(config);
    let issuer =
        IssuerUrl::new(issuer_url.clone()).map_err(|e| OAuthError::Provider(e.to_string()))?;

    tracing::debug!(url = %issuer_url, "fetching OIDC discovery document");

    CoreProviderMetadata::discover_async(issuer, http_client)
        .await
        .map_err(|e| OAuthError::Provider(e.to_string()))
}

fn discovery_issuer_url(config: &OidcProviderConfig) -> String {
    let source = if config.discovery_url.is_empty() {
        &config.authority
    } else {
        &config.discovery_url
    };

    source
        .strip_suffix("/.well-known/openid-configuration")
        .unwrap_or(source)
        .trim_end_matches('/')
        .to_string()
}

fn get_claim(claims: &OidcUserInfoClaims, name: &str) -> Option<String> {
    let standard = claims.standard_claims();
    match name {
        "sub" => Some(claims.subject().as_str().to_owned()),
        "email" => standard.email().map(|e| e.as_str().to_owned()),
        "preferred_username" => standard.preferred_username().map(|u| u.as_str().to_owned()),
        "name" => standard
            .name()
            .and_then(|n| n.get(None))
            .map(|n| n.as_str().to_owned()),
        _ => claims
            .additional_claims()
            .extra
            .get(name)
            .and_then(|v| v.as_str())
            .map(str::to_owned),
    }
}

#[cfg(test)]
mod tests {
    use crate::config::OidcProviderConfig;

    use super::discovery_issuer_url;

    #[test]
    fn discovery_issuer_url_accepts_well_known_document_url() {
        let config = OidcProviderConfig {
            discovery_url: "https://id.lmgr.io/.well-known/openid-configuration".to_string(),
            ..Default::default()
        };

        assert_eq!(discovery_issuer_url(&config), "https://id.lmgr.io");
    }

    #[test]
    fn discovery_issuer_url_accepts_base_issuer_url() {
        let config = OidcProviderConfig {
            discovery_url: "https://id.lmgr.io".to_string(),
            ..Default::default()
        };

        assert_eq!(discovery_issuer_url(&config), "https://id.lmgr.io");
    }
}
