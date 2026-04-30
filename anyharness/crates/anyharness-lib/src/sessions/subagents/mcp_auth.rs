use std::io::{ErrorKind, Write};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use aes_gcm_siv::aead::rand_core::RngCore;
use aes_gcm_siv::aead::OsRng;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const SECRET_DIR: &str = "secrets";
const SECRET_FILE_NAME: &str = "subagent-mcp-token.key";
const CAPABILITY_HEADER_NAME: &str = "x-subagent-session-token";
const TOKEN_TTL_SECONDS: i64 = 60 * 60 * 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityTokenPayload {
    workspace_id: String,
    session_id: String,
    exp: i64,
}

#[derive(Clone)]
pub struct SubagentMcpAuth {
    secret_path: PathBuf,
}

impl SubagentMcpAuth {
    pub fn new(runtime_home: PathBuf) -> Self {
        Self {
            secret_path: runtime_home.join(SECRET_DIR).join(SECRET_FILE_NAME),
        }
    }

    pub fn capability_header_name(&self) -> &'static str {
        CAPABILITY_HEADER_NAME
    }

    pub fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        let secret = self.load_or_create_secret()?;
        let payload = CapabilityTokenPayload {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            exp: chrono::Utc::now().timestamp() + TOKEN_TTL_SECONDS,
        };
        let payload_json = serde_json::to_vec(&payload)?;
        let payload_encoded = URL_SAFE_NO_PAD.encode(payload_json);
        let signature = sign(&secret, payload_encoded.as_bytes());
        Ok(format!(
            "{payload_encoded}.{}",
            URL_SAFE_NO_PAD.encode(signature)
        ))
    }

    pub fn validate_capability_token(
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

        let expected = sign(&secret, payload_encoded.as_bytes());
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
}

fn sign(secret: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(secret);
    hasher.update(b".");
    hasher.update(payload);
    hasher.finalize().to_vec()
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
