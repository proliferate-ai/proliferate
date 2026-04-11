use std::fmt;

use aes_gcm_siv::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm_siv::Aes256GcmSiv;
use agent_client_protocol as acp;
use anyharness_contract::v1::SessionMcpServer as ContractSessionMcpServer;
use anyhow::Context;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::model::SessionRecord;
use crate::workspaces::model::WorkspaceRecord;

pub const DATA_KEY_ENV_VAR: &str = "ANYHARNESS_DATA_KEY";
const CIPHERTEXT_PREFIX: &str = "v1:";
const NONCE_LEN: usize = 12;

pub const SESSION_RESTART_REQUIRED_DETAIL: &str =
    "This session's MCP bindings can't be decrypted. Please restart the session.";

#[derive(Clone)]
pub struct SessionDataCipher {
    key_bytes: [u8; 32],
}

impl SessionDataCipher {
    pub fn from_env_value(value: &str) -> Result<Self, String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err("must not be blank".to_string());
        }

        let decoded = STANDARD
            .decode(trimmed)
            .or_else(|_| URL_SAFE_NO_PAD.decode(trimmed))
            .map_err(|error| format!("must be valid base64: {error}"))?;
        let key_bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| "must decode to exactly 32 bytes".to_string())?;

        Ok(Self { key_bytes })
    }

    fn algorithm(&self) -> Aes256GcmSiv {
        Aes256GcmSiv::new_from_slice(&self.key_bytes).expect("32-byte key")
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpHeader {
    pub name: String,
    pub value: String,
}

impl fmt::Debug for SessionMcpHeader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionMcpHeader")
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpEnvVar {
    pub name: String,
    pub value: String,
}

impl fmt::Debug for SessionMcpEnvVar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionMcpEnvVar")
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpHttpServer {
    pub connection_id: String,
    pub catalog_entry_id: Option<String>,
    pub server_name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<SessionMcpHeader>,
}

impl fmt::Debug for SessionMcpHttpServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let header_names: Vec<&str> = self
            .headers
            .iter()
            .map(|header| header.name.as_str())
            .collect();
        f.debug_struct("SessionMcpHttpServer")
            .field("connection_id", &self.connection_id)
            .field("catalog_entry_id", &self.catalog_entry_id)
            .field("server_name", &self.server_name)
            .field("url", &"<redacted>")
            .field("header_names", &header_names)
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpStdioServer {
    pub connection_id: String,
    pub catalog_entry_id: Option<String>,
    pub server_name: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<SessionMcpEnvVar>,
}

impl fmt::Debug for SessionMcpStdioServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let env_names: Vec<&str> = self
            .env
            .iter()
            .map(|variable| variable.name.as_str())
            .collect();
        f.debug_struct("SessionMcpStdioServer")
            .field("connection_id", &self.connection_id)
            .field("catalog_entry_id", &self.catalog_entry_id)
            .field("server_name", &self.server_name)
            .field("command", &self.command)
            .field("arg_count", &self.args.len())
            .field("env_names", &env_names)
            .finish()
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "transport")]
pub enum SessionMcpServer {
    Http(SessionMcpHttpServer),
    Stdio(SessionMcpStdioServer),
}

impl fmt::Debug for SessionMcpServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(server) => f.debug_tuple("Http").field(server).finish(),
            Self::Stdio(server) => f.debug_tuple("Stdio").field(server).finish(),
        }
    }
}

pub enum SessionMcpBindingsError {
    MissingDataKey,
    Encrypt(anyhow::Error),
    Decrypt(anyhow::Error),
}

impl fmt::Debug for SessionMcpBindingsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingDataKey => write!(f, "SessionMcpBindingsError::MissingDataKey"),
            Self::Encrypt(error) => f
                .debug_tuple("SessionMcpBindingsError::Encrypt")
                .field(&error.to_string())
                .finish(),
            Self::Decrypt(error) => f
                .debug_tuple("SessionMcpBindingsError::Decrypt")
                .field(&error.to_string())
                .finish(),
        }
    }
}

impl SessionMcpBindingsError {
    pub fn missing_data_key_detail() -> &'static str {
        "ANYHARNESS_DATA_KEY is required when MCP bindings are present."
    }
}

pub trait SessionMcpProviderSource: Send + Sync {
    fn providers_for(
        &self,
        session: &SessionRecord,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Vec<SessionMcpServer>>;

    fn system_prompt_append(
        &self,
        _session: &SessionRecord,
        _workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Option<String>> {
        Ok(None)
    }

    fn startup_meta(
        &self,
        _session: &SessionRecord,
        _workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Option<Map<String, Value>>> {
        Ok(None)
    }
}

pub fn load_data_cipher_from_env() -> Result<Option<SessionDataCipher>, String> {
    let Some(value) = std::env::var(DATA_KEY_ENV_VAR).ok() else {
        return Ok(None);
    };
    SessionDataCipher::from_env_value(&value).map(Some)
}

pub fn bindings_from_contract(bindings: Vec<ContractSessionMcpServer>) -> Vec<SessionMcpServer> {
    bindings
        .into_iter()
        .map(|binding| match binding {
            ContractSessionMcpServer::Http(server) => {
                SessionMcpServer::Http(SessionMcpHttpServer {
                    connection_id: server.connection_id,
                    catalog_entry_id: server.catalog_entry_id,
                    server_name: server.server_name,
                    url: server.url,
                    headers: server
                        .headers
                        .into_iter()
                        .map(|header| SessionMcpHeader {
                            name: header.name,
                            value: header.value,
                        })
                        .collect(),
                })
            }
            ContractSessionMcpServer::Stdio(server) => {
                SessionMcpServer::Stdio(SessionMcpStdioServer {
                    connection_id: server.connection_id,
                    catalog_entry_id: server.catalog_entry_id,
                    server_name: server.server_name,
                    command: server.command,
                    args: server.args,
                    env: server
                        .env
                        .into_iter()
                        .map(|env_var| SessionMcpEnvVar {
                            name: env_var.name,
                            value: env_var.value,
                        })
                        .collect(),
                })
            }
        })
        .collect()
}

pub fn encrypt_bindings(
    cipher: Option<&SessionDataCipher>,
    bindings: &[SessionMcpServer],
) -> Result<Option<String>, SessionMcpBindingsError> {
    if bindings.is_empty() {
        return Ok(None);
    }

    let Some(cipher) = cipher else {
        return Err(SessionMcpBindingsError::MissingDataKey);
    };

    let plaintext = serde_json::to_vec(bindings)
        .context("serialize MCP bindings")
        .map_err(SessionMcpBindingsError::Encrypt)?;

    let nonce = Aes256GcmSiv::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .algorithm()
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|error| anyhow::anyhow!("encrypt MCP bindings: {error}"))
        .map_err(SessionMcpBindingsError::Encrypt)?;

    let mut encoded = nonce.to_vec();
    encoded.extend(ciphertext);
    Ok(Some(format!(
        "{CIPHERTEXT_PREFIX}{}",
        STANDARD.encode(encoded)
    )))
}

pub fn decrypt_bindings(
    cipher: Option<&SessionDataCipher>,
    ciphertext: Option<&str>,
) -> Result<Vec<SessionMcpServer>, SessionMcpBindingsError> {
    let Some(ciphertext) = ciphertext.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(Vec::new());
    };
    let Some(cipher) = cipher else {
        return Err(SessionMcpBindingsError::MissingDataKey);
    };

    let encoded = ciphertext
        .strip_prefix(CIPHERTEXT_PREFIX)
        .ok_or_else(|| anyhow::anyhow!("unsupported MCP binding ciphertext version"))
        .map_err(SessionMcpBindingsError::Decrypt)?;
    let decoded = STANDARD
        .decode(encoded)
        .context("decode MCP binding ciphertext")
        .map_err(SessionMcpBindingsError::Decrypt)?;
    if decoded.len() <= NONCE_LEN {
        return Err(SessionMcpBindingsError::Decrypt(anyhow::anyhow!(
            "ciphertext payload missing nonce"
        )));
    }

    let (nonce_bytes, encrypted) = decoded.split_at(NONCE_LEN);
    let plaintext = cipher
        .algorithm()
        .decrypt(nonce_bytes.into(), encrypted)
        .map_err(|error| anyhow::anyhow!("decrypt MCP bindings: {error}"))
        .map_err(SessionMcpBindingsError::Decrypt)?;
    serde_json::from_slice(&plaintext)
        .context("deserialize MCP bindings")
        .map_err(SessionMcpBindingsError::Decrypt)
}

pub fn to_acp_servers(bindings: &[SessionMcpServer]) -> Vec<acp::McpServer> {
    bindings
        .iter()
        .map(|binding| match binding {
            SessionMcpServer::Http(server) => acp::McpServer::Http(
                acp::McpServerHttp::new(server.server_name.clone(), server.url.clone()).headers(
                    server
                        .headers
                        .iter()
                        .map(|header| {
                            acp::HttpHeader::new(header.name.clone(), header.value.clone())
                        })
                        .collect(),
                ),
            ),
            SessionMcpServer::Stdio(server) => acp::McpServer::Stdio(
                acp::McpServerStdio::new(server.server_name.clone(), server.command.clone())
                    .args(server.args.clone())
                    .env(
                        server
                            .env
                            .iter()
                            .map(|env_var| {
                                acp::EnvVariable::new(env_var.name.clone(), env_var.value.clone())
                            })
                            .collect(),
                    ),
            ),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_http_binding() -> SessionMcpServer {
        SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: "connection-1".to_string(),
            catalog_entry_id: Some("github".to_string()),
            server_name: "github".to_string(),
            url: "https://api.github.com/mcp?appid=secret".to_string(),
            headers: vec![SessionMcpHeader {
                name: "Authorization".to_string(),
                value: "Bearer secret".to_string(),
            }],
        })
    }

    fn sample_stdio_binding() -> SessionMcpServer {
        SessionMcpServer::Stdio(SessionMcpStdioServer {
            connection_id: "connection-2".to_string(),
            catalog_entry_id: Some("filesystem".to_string()),
            server_name: "filesystem".to_string(),
            command: "mcp-server-filesystem".to_string(),
            args: vec!["/workspace".to_string()],
            env: vec![SessionMcpEnvVar {
                name: "API_KEY".to_string(),
                value: "secret".to_string(),
            }],
        })
    }

    fn sample_cipher() -> SessionDataCipher {
        SessionDataCipher::from_env_value("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
            .expect("cipher")
    }

    #[test]
    fn encrypt_and_decrypt_bindings_round_trip() {
        let bindings = vec![sample_http_binding(), sample_stdio_binding()];
        let ciphertext = encrypt_bindings(Some(&sample_cipher()), &bindings)
            .expect("encrypt bindings")
            .expect("ciphertext");

        let restored =
            decrypt_bindings(Some(&sample_cipher()), Some(&ciphertext)).expect("decrypt bindings");

        assert_eq!(restored, bindings);
    }

    #[test]
    fn encrypt_requires_data_key_when_bindings_present() {
        let error =
            encrypt_bindings(None, &[sample_http_binding()]).expect_err("missing key error");
        assert!(matches!(error, SessionMcpBindingsError::MissingDataKey));
    }

    #[test]
    fn decrypt_requires_restart_when_ciphertext_is_corrupt() {
        let error = decrypt_bindings(Some(&sample_cipher()), Some("v1:not-valid-base64"))
            .expect_err("decrypt error");
        assert!(matches!(error, SessionMcpBindingsError::Decrypt(_)));
    }

    #[test]
    fn stdio_debug_redacts_env_values() {
        let debug_output = format!("{:?}", sample_stdio_binding());
        assert!(!debug_output.contains("secret"));
        assert!(debug_output.contains("API_KEY"));
    }

    #[test]
    fn to_acp_servers_maps_stdio_transport() {
        let bindings = vec![sample_stdio_binding()];
        let mapped = to_acp_servers(&bindings);
        assert_eq!(mapped.len(), 1);
        assert!(matches!(mapped[0], acp::McpServer::Stdio(_)));
    }
}
