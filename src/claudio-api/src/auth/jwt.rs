use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rsa::{
    pkcs1::{DecodeRsaPrivateKey, EncodeRsaPrivateKey, LineEnding as Pkcs1LineEnding},
    pkcs8::spki::{der::pem::LineEnding as SpkiLineEnding, EncodePublicKey},
    RsaPrivateKey,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JwtError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("rsa error: {0}")]
    Rsa(String),
    #[error("jwt error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

pub struct JwtKeys {
    pub encoding: EncodingKey,
    pub decoding: DecodingKey,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub name: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

impl JwtKeys {
    pub fn load_or_generate(config_dir: &Path) -> Result<Self, JwtError> {
        let key_path = config_dir.join("claudio-signing.key");

        let private_key = if key_path.exists() {
            let pem = std::fs::read_to_string(&key_path)?;
            RsaPrivateKey::from_pkcs1_pem(&pem).map_err(|e| JwtError::Rsa(e.to_string()))?
        } else {
            let key = RsaPrivateKey::new(&mut rand_core::OsRng, 2048)
                .map_err(|e| JwtError::Rsa(e.to_string()))?;
            let pem = key
                .to_pkcs1_pem(Pkcs1LineEnding::LF)
                .map_err(|e| JwtError::Rsa(e.to_string()))?;
            std::fs::write(&key_path, pem.as_bytes())?;
            key
        };

        // PKCS#1 private key PEM for signing
        let priv_pem = private_key
            .to_pkcs1_pem(Pkcs1LineEnding::LF)
            .map_err(|e| JwtError::Rsa(e.to_string()))?;
        let encoding = EncodingKey::from_rsa_pem(priv_pem.as_bytes())?;

        // SPKI public key PEM for verification (what jsonwebtoken expects)
        let pub_pem = private_key
            .to_public_key()
            .to_public_key_pem(SpkiLineEnding::LF)
            .map_err(|e| JwtError::Rsa(e.to_string()))?;
        let decoding = DecodingKey::from_rsa_pem(pub_pem.as_bytes())?;

        Ok(JwtKeys { encoding, decoding })
    }

    pub fn sign(&self, claims: Claims) -> Result<String, JwtError> {
        let header = Header::new(Algorithm::RS256);
        Ok(jsonwebtoken::encode(&header, &claims, &self.encoding)?)
    }

    pub fn verify(&self, token: &str) -> Result<Claims, JwtError> {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.validate_exp = true;
        let data = jsonwebtoken::decode::<Claims>(token, &self.decoding, &validation)?;
        Ok(data.claims)
    }
}

pub fn make_access_token_claims(user_id: i32, username: &str, role: &str) -> Claims {
    let now = chrono::Utc::now().timestamp();
    Claims {
        sub: user_id.to_string(),
        name: username.to_string(),
        role: role.to_string(),
        iat: now,
        exp: now + 3600,
    }
}
