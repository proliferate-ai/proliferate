use std::io::{ErrorKind, Write};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use aes_gcm_siv::aead::rand_core::RngCore;
use aes_gcm_siv::aead::OsRng;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const SECRET_DIR: &str = "secrets";

#[derive(Debug, Clone, Copy)]
pub enum McpCapabilityTokenSignature {
    LegacySha256Dot,
    HmacSha256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct CapabilityTokenPayload {
    workspace_id: String,
    session_id: String,
    exp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct ProductCapabilityTokenPayload {
    workspace_id: String,
    session_id: String,
    product_mcp_id: String,
    exp: i64,
}

#[derive(Debug, Clone)]
pub struct ProductMcpCapabilityScope<'a> {
    pub workspace_id: &'a str,
    pub session_id: &'a str,
    pub product_mcp_id: &'a str,
}

#[derive(Clone)]
pub struct McpCapabilityTokenIssuer {
    secret_path: PathBuf,
    signature: McpCapabilityTokenSignature,
    ttl_seconds: i64,
}

impl McpCapabilityTokenIssuer {
    pub fn new(
        runtime_home: PathBuf,
        secret_file_name: &'static str,
        signature: McpCapabilityTokenSignature,
        ttl_seconds: i64,
    ) -> Self {
        Self {
            secret_path: runtime_home.join(SECRET_DIR).join(secret_file_name),
            signature,
            ttl_seconds,
        }
    }

    pub fn mint_workspace_session_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        let secret = self.load_or_create_secret()?;
        let payload = CapabilityTokenPayload {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            exp: chrono::Utc::now().timestamp() + self.ttl_seconds,
        };
        let payload_json = serde_json::to_vec(&payload)?;
        let payload_encoded = URL_SAFE_NO_PAD.encode(payload_json);
        let signature = self.sign(&secret, payload_encoded.as_bytes());
        Ok(format!(
            "{payload_encoded}.{}",
            URL_SAFE_NO_PAD.encode(signature)
        ))
    }

    pub fn validate_workspace_session_token(
        &self,
        token: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<bool> {
        let secret = self.load_or_create_secret()?;
        let mut parts = token.split('.');
        let Some(payload_encoded) = parts.next() else {
            return Ok(false);
        };
        let Some(signature_encoded) = parts.next() else {
            return Ok(false);
        };
        if parts.next().is_some() {
            return Ok(false);
        }

        let expected = self.sign(&secret, payload_encoded.as_bytes());
        let Ok(provided) = URL_SAFE_NO_PAD.decode(signature_encoded) else {
            return Ok(false);
        };
        if expected.as_slice().ct_eq(provided.as_slice()).unwrap_u8() != 1 {
            return Ok(false);
        }

        let Ok(payload_json) = URL_SAFE_NO_PAD.decode(payload_encoded) else {
            return Ok(false);
        };
        let Ok(payload) = serde_json::from_slice::<CapabilityTokenPayload>(&payload_json) else {
            return Ok(false);
        };
        if payload.workspace_id != workspace_id || payload.session_id != session_id {
            return Ok(false);
        }
        if payload.exp < chrono::Utc::now().timestamp() {
            return Ok(false);
        }
        Ok(true)
    }

    pub fn mint_product_mcp_token(
        &self,
        scope: ProductMcpCapabilityScope<'_>,
    ) -> anyhow::Result<String> {
        let secret = self.load_or_create_secret()?;
        let payload = ProductCapabilityTokenPayload {
            workspace_id: scope.workspace_id.to_string(),
            session_id: scope.session_id.to_string(),
            product_mcp_id: scope.product_mcp_id.to_string(),
            exp: chrono::Utc::now().timestamp() + self.ttl_seconds,
        };
        let payload_json = serde_json::to_vec(&payload)?;
        let payload_encoded = URL_SAFE_NO_PAD.encode(payload_json);
        let signature = self.sign(&secret, payload_encoded.as_bytes());
        Ok(format!(
            "{payload_encoded}.{}",
            URL_SAFE_NO_PAD.encode(signature)
        ))
    }

    pub fn validate_product_mcp_token(
        &self,
        token: &str,
        scope: ProductMcpCapabilityScope<'_>,
    ) -> anyhow::Result<bool> {
        let secret = self.load_or_create_secret()?;
        let mut parts = token.split('.');
        let Some(payload_encoded) = parts.next() else {
            return Ok(false);
        };
        let Some(signature_encoded) = parts.next() else {
            return Ok(false);
        };
        if parts.next().is_some() {
            return Ok(false);
        }

        let expected = self.sign(&secret, payload_encoded.as_bytes());
        let Ok(provided) = URL_SAFE_NO_PAD.decode(signature_encoded) else {
            return Ok(false);
        };
        if expected.as_slice().ct_eq(provided.as_slice()).unwrap_u8() != 1 {
            return Ok(false);
        }

        let Ok(payload_json) = URL_SAFE_NO_PAD.decode(payload_encoded) else {
            return Ok(false);
        };
        let Ok(payload) = serde_json::from_slice::<ProductCapabilityTokenPayload>(&payload_json)
        else {
            return Ok(false);
        };
        if payload.workspace_id != scope.workspace_id
            || payload.session_id != scope.session_id
            || payload.product_mcp_id != scope.product_mcp_id
        {
            return Ok(false);
        }
        if payload.exp < chrono::Utc::now().timestamp() {
            return Ok(false);
        }
        Ok(true)
    }

    fn load_or_create_secret(&self) -> anyhow::Result<Vec<u8>> {
        ensure_parent_dir(&self.secret_path)?;
        if self.secret_path.exists() {
            return read_secret_file(&self.secret_path);
        }

        let mut secret = vec![0u8; 32];
        OsRng.fill_bytes(&mut secret);
        match write_secret_file(&self.secret_path, &URL_SAFE_NO_PAD.encode(&secret)) {
            Ok(()) => Ok(secret),
            Err(error) if is_already_exists(&error) => read_secret_file(&self.secret_path),
            Err(error) => Err(error),
        }
    }

    fn sign(&self, secret: &[u8], payload: &[u8]) -> Vec<u8> {
        match self.signature {
            McpCapabilityTokenSignature::LegacySha256Dot => {
                let mut hasher = Sha256::new();
                hasher.update(secret);
                hasher.update(b".");
                hasher.update(payload);
                hasher.finalize().to_vec()
            }
            McpCapabilityTokenSignature::HmacSha256 => {
                let mut mac =
                    Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts any key length");
                mac.update(payload);
                mac.finalize().into_bytes().to_vec()
            }
        }
    }
}

fn ensure_parent_dir(path: &Path) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("missing parent directory for {}", path.display()))?;
    std::fs::create_dir_all(parent)?;
    Ok(())
}

fn read_secret_file(path: &Path) -> anyhow::Result<Vec<u8>> {
    let encoded = std::fs::read_to_string(path)?;
    URL_SAFE_NO_PAD
        .decode(encoded.trim())
        .map_err(anyhow::Error::from)
}

fn is_already_exists(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<std::io::Error>()
        .is_some_and(|inner| inner.kind() == ErrorKind::AlreadyExists)
}

#[cfg(unix)]
fn write_secret_file(path: &Path, contents: &str) -> anyhow::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(contents.as_bytes())?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_secret_file(path: &Path, contents: &str) -> anyhow::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)?;
    file.write_all(contents.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_home(test_name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-mcp-capability-token-{test_name}-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn validates_hmac_workspace_session_token() {
        let home = runtime_home("hmac");
        let issuer = McpCapabilityTokenIssuer::new(
            home.clone(),
            "hmac.key",
            McpCapabilityTokenSignature::HmacSha256,
            60,
        );

        let token = issuer
            .mint_workspace_session_token("workspace-1", "session-1")
            .unwrap();

        assert!(issuer
            .validate_workspace_session_token(&token, "workspace-1", "session-1")
            .unwrap());
        assert!(!issuer
            .validate_workspace_session_token(&token, "workspace-1", "session-2")
            .unwrap());

        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn validates_product_mcp_token_scope() {
        let home = runtime_home("product");
        let issuer = McpCapabilityTokenIssuer::new(
            home.clone(),
            "product.key",
            McpCapabilityTokenSignature::HmacSha256,
            60,
        );

        let token = issuer
            .mint_product_mcp_token(ProductMcpCapabilityScope {
                workspace_id: "workspace-1",
                session_id: "session-1",
                product_mcp_id: "reviews",
            })
            .unwrap();

        assert!(issuer
            .validate_product_mcp_token(
                &token,
                ProductMcpCapabilityScope {
                    workspace_id: "workspace-1",
                    session_id: "session-1",
                    product_mcp_id: "reviews",
                },
            )
            .unwrap());
        assert!(!issuer
            .validate_product_mcp_token(
                &token,
                ProductMcpCapabilityScope {
                    workspace_id: "workspace-1",
                    session_id: "session-1",
                    product_mcp_id: "subagents",
                },
            )
            .unwrap());
        assert!(!issuer
            .validate_workspace_session_token(&token, "workspace-1", "session-1")
            .unwrap());

        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn validates_legacy_workspace_session_token() {
        let home = runtime_home("legacy");
        let issuer = McpCapabilityTokenIssuer::new(
            home.clone(),
            "legacy.key",
            McpCapabilityTokenSignature::LegacySha256Dot,
            60,
        );

        let token = issuer
            .mint_workspace_session_token("workspace-1", "session-1")
            .unwrap();

        assert!(issuer
            .validate_workspace_session_token(&token, "workspace-1", "session-1")
            .unwrap());
        assert!(!issuer
            .validate_workspace_session_token(&token, "workspace-2", "session-1")
            .unwrap());

        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn signature_algorithms_are_not_interchangeable() {
        let home = runtime_home("algorithm");
        let legacy = McpCapabilityTokenIssuer::new(
            home.clone(),
            "shared.key",
            McpCapabilityTokenSignature::LegacySha256Dot,
            60,
        );
        let hmac = McpCapabilityTokenIssuer::new(
            home.clone(),
            "shared.key",
            McpCapabilityTokenSignature::HmacSha256,
            60,
        );

        let token = legacy
            .mint_workspace_session_token("workspace-1", "session-1")
            .unwrap();

        assert!(!hmac
            .validate_workspace_session_token(&token, "workspace-1", "session-1")
            .unwrap());

        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn rejects_malformed_tokens() {
        let home = runtime_home("malformed");
        let issuer = McpCapabilityTokenIssuer::new(
            home.clone(),
            "malformed.key",
            McpCapabilityTokenSignature::HmacSha256,
            60,
        );

        assert!(!issuer
            .validate_workspace_session_token("", "workspace-1", "session-1")
            .unwrap());
        assert!(!issuer
            .validate_workspace_session_token("payload-only", "workspace-1", "session-1")
            .unwrap());
        assert!(!issuer
            .validate_workspace_session_token("payload.signature.extra", "workspace-1", "session-1")
            .unwrap());

        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn rejects_expired_tokens() {
        let home = runtime_home("expired");
        let issuer = McpCapabilityTokenIssuer::new(
            home.clone(),
            "expired.key",
            McpCapabilityTokenSignature::HmacSha256,
            -1,
        );

        let token = issuer
            .mint_workspace_session_token("workspace-1", "session-1")
            .unwrap();

        assert!(!issuer
            .validate_workspace_session_token(&token, "workspace-1", "session-1")
            .unwrap());

        let _ = std::fs::remove_dir_all(home);
    }
}
