//! Runtime auth-profile resolution: state file + requested harness → the
//! decided [`AgentRuntimeAuthProfile`], or a typed error.
//!
//! This is the pure decision layer (contract §4). It does NOT touch the
//! filesystem or render env; `render.rs` turns a resolved profile into
//! env/args/config file specs, and the launcher applies those specs.
//!
//! Composition is just "a list of sources": the server already validated which
//! source combinations are legal per harness (contract §2), so resolution here
//! is a straight mapping — the harness entry's enabled `sources[]` become
//! typed [`ResolvedSource`]s. Absent harness or empty sources → [`Native`]
//! (empty delta; the harness's own login owns auth). The only failures are
//! shape problems the server should never emit: an unknown source `kind` or a
//! source missing its required fields.
//!
//! [`Native`]: AgentRuntimeAuthProfile::Native

use std::collections::BTreeMap;
use std::fmt;

use super::redact::{redacted, RedactedEnv};
use super::state::{
    AgentAuthState, AuthSource, SOURCE_KIND_API_KEY, SOURCE_KIND_GATEWAY,
    SOURCE_KIND_PROVIDER_CONFIG, SOURCE_KIND_SEAT,
};
use super::RouteAuthError;

/// The resolved auth profile for one harness launch. `Native` renders nothing
/// (the harness's own detection/login owns auth); `Sources` carries the enabled
/// credential sources to compose additively at render time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentRuntimeAuthProfile {
    Native,
    Sources(HarnessSources),
}

/// A harness plus its enabled, typed credential sources (contract §4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessSources {
    pub harness_kind: String,
    /// The state revision that produced these sources — carried so switch-time
    /// materialization (codex/grok/opencode isolated dirs) can key directory
    /// names and GC stale ones.
    pub revision: i64,
    pub sources: Vec<ResolvedSource>,
    /// The seat-rotation toggle, from the document's `settings["rotate"]`:
    /// `true` when absent or not a bool (rotation is the default), `false`
    /// only on an explicit `false`. Consumed by the launch seam's rotation
    /// decision; meaningless (and ignored) for seatless profiles.
    pub rotate: bool,
}

/// One resolved credential source (contract §3 `sources[]`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedSource {
    Gateway(GatewayProfile),
    ApiKey(ApiKeyProfile),
    ProviderConfig(ProviderConfigProfile),
    Seat(SeatProfile),
}

/// A raw provider key destined for a free-form env var (contract §4: `api_key`
/// source → `set[env_var_name] = value`, nothing else).
#[derive(Clone, PartialEq, Eq)]
pub struct ApiKeyProfile {
    pub env_var_name: String,
    pub value: String,
}

/// Hand-written so `value` (a live provider key) can never reach `Debug`
/// output — secrets must not be printable, even through a test panic.
impl fmt::Debug for ApiKeyProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApiKeyProfile")
            .field("env_var_name", &self.env_var_name)
            .field("value", &redacted(&self.value))
            .finish()
    }
}

/// A LiteLLM virtual key + public gateway base URL. The per-harness gateway
/// recipe (render.rs) decides how the CLI is pointed at it.
#[derive(Clone, PartialEq, Eq)]
pub struct GatewayProfile {
    /// The public gateway base URL (root, no per-harness suffix — the recipes
    /// append `/v1`, etc. per the live matrix).
    pub base_url: String,
    pub key: String,
}

/// Hand-written so `key` (the live virtual key) can never reach `Debug`
/// output — secrets must not be printable, even through a test panic.
impl fmt::Debug for GatewayProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GatewayProfile")
            .field("base_url", &self.base_url)
            .field("key", &redacted(&self.key))
            .finish()
    }
}

/// A typed provider config (Track D: "use my own cloud provider account" —
/// Bedrock, Azure OpenAI/Foundry). `env` is ALREADY the harness's real env-var
/// map: Python resolved the vault's generic fields into harness-correct names
/// before the source ever reached Rust (agent-auth.md's wire contract). The
/// per-harness recipe (render.rs) consumes `config_kind` only to pick which
/// arm to run — never to rename a field.
#[derive(Clone, PartialEq, Eq)]
pub struct ProviderConfigProfile {
    pub config_kind: String,
    pub env: BTreeMap<String, String>,
}

/// Hand-written so `env`'s values (the user's own cloud-provider credentials)
/// can never reach `Debug` output; the key NAMES are not secrets and stay
/// readable for debugging.
impl fmt::Debug for ProviderConfigProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProviderConfigProfile")
            .field("config_kind", &self.config_kind)
            .field("env", &RedactedEnv(&self.env))
            .finish()
    }
}

/// A seat (seats v1): "run on this Max subscription". `env` is ALREADY the
/// harness's real env-var map (for claude exactly
/// `{CLAUDE_CODE_OAUTH_TOKEN: <token>}`) — same wire ruling as
/// `provider_config`: the recipe `.set()`s exact keys, never renames.
/// `seat_id` names the vault entry so status/refusals can identify the seat
/// without ever echoing the token. The document carries the pool in vault
/// order; the render plane serves the first (rotation is a later slice).
#[derive(Clone, PartialEq, Eq)]
pub struct SeatProfile {
    pub seat_id: String,
    pub env: BTreeMap<String, String>,
}

/// Hand-written so `env`'s values (the seat's OAuth token) can never reach
/// `Debug` output; `seat_id` and the key NAMES are not secrets and stay
/// readable for debugging.
impl fmt::Debug for SeatProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SeatProfile")
            .field("seat_id", &self.seat_id)
            .field("env", &RedactedEnv(&self.env))
            .finish()
    }
}

/// Resolve the auth profile for `harness_kind` from the loaded state.
///
/// The three-way answer is agent-auth.md's law "Absent means native;
/// present-but-empty fails closed":
///
/// - `state == None` (no file): `Native`. Nothing was ever selected.
/// - harness **absent** from the document: `Native`. The user never configured
///   this harness, so its own CLI sign-in owns auth — the least-surprising
///   default, and safe (never ambient or leaked credentials).
/// - harness **present with an empty source list**:
///   [`RouteAuthError::SelectionMissing`]. The user DID select a route and the
///   renderer could not satisfy any of it (unsynced enrollment, exhausted
///   budget, revoked key). Silently treating that as native is the
///   silent-degradation bug: a desktop user with a native claude login whose
///   gateway budget exhausts would start billing their personal Anthropic
///   account mid-session with no signal.
/// - harness present with sources: each source is validated + typed. An unknown
///   `kind`, or a source missing its required fields, is a typed error (the
///   server should never emit these).
pub fn resolve_profile(
    state: Option<&AgentAuthState>,
    harness_kind: &str,
) -> Result<AgentRuntimeAuthProfile, RouteAuthError> {
    let Some(state) = state else {
        return Ok(AgentRuntimeAuthProfile::Native);
    };
    // Absent vs present-but-empty: `None` is native, `Some([])` fails closed.
    let Some(entry) = state
        .harnesses
        .iter()
        .find(|entry| entry.harness_kind == harness_kind)
    else {
        return Ok(AgentRuntimeAuthProfile::Native);
    };
    if entry.sources.is_empty() {
        return Err(RouteAuthError::SelectionMissing {
            harness_kind: harness_kind.to_string(),
            revision: state.revision,
            reason: clamp_unsatisfied_reason(entry.unsatisfied_reason.as_deref()),
        });
    }
    let mut sources = Vec::with_capacity(entry.sources.len());
    for source in &entry.sources {
        sources.push(resolve_source(harness_kind, source)?);
    }
    // `settings["rotate"]`: absent or non-bool → true (rotation is the
    // default); only an explicit `false` pins the applied seat.
    let rotate = entry
        .settings
        .as_ref()
        .and_then(|settings| settings.get("rotate"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    Ok(AgentRuntimeAuthProfile::Sources(HarnessSources {
        harness_kind: harness_kind.to_string(),
        revision: state.revision,
        sources,
        rotate,
    }))
}

fn resolve_source(
    harness_kind: &str,
    source: &AuthSource,
) -> Result<ResolvedSource, RouteAuthError> {
    match source.kind.as_str() {
        SOURCE_KIND_GATEWAY => {
            let base_url = require_field(harness_kind, source.base_url.as_deref(), "base_url")?;
            let key = require_field(harness_kind, source.key.as_deref(), "key")?;
            Ok(ResolvedSource::Gateway(GatewayProfile { base_url, key }))
        }
        SOURCE_KIND_API_KEY => {
            let env_var_name =
                require_field(harness_kind, source.env_var_name.as_deref(), "env_var_name")?;
            let value = require_field(harness_kind, source.value.as_deref(), "value")?;
            Ok(ResolvedSource::ApiKey(ApiKeyProfile {
                env_var_name,
                value,
            }))
        }
        SOURCE_KIND_PROVIDER_CONFIG => {
            let config_kind =
                require_field(harness_kind, source.config_kind.as_deref(), "config_kind")?;
            let env = source
                .env
                .clone()
                .filter(|env| !env.is_empty())
                .ok_or_else(|| RouteAuthError::SelectionIncomplete {
                    harness_kind: harness_kind.to_string(),
                    detail: "source is missing required non-empty field 'env'".to_string(),
                })?;
            Ok(ResolvedSource::ProviderConfig(ProviderConfigProfile {
                config_kind,
                env,
            }))
        }
        SOURCE_KIND_SEAT => {
            let seat_id = require_field(harness_kind, source.seat_id.as_deref(), "seat_id")?;
            let env = source
                .env
                .clone()
                .filter(|env| !env.is_empty())
                .ok_or_else(|| RouteAuthError::SelectionIncomplete {
                    harness_kind: harness_kind.to_string(),
                    detail: "source is missing required non-empty field 'env'".to_string(),
                })?;
            Ok(ResolvedSource::Seat(SeatProfile { seat_id, env }))
        }
        unknown => Err(RouteAuthError::UnsupportedRoute {
            harness_kind: harness_kind.to_string(),
            detail: format!("unknown agent-auth source kind '{unknown}'"),
        }),
    }
}

/// The longest `unsatisfied_reason` a refusal will speak verbatim. The
/// server's vocabulary is a handful of short plain sentences (the longest is
/// well under 100 chars); anything longer is not one of them.
const MAX_UNSATISFIED_REASON_CHARS: usize = 200;

/// A run of this many `[A-Za-z0-9_-]` characters reads as a token, not words.
const TOKEN_RUN_CHARS: usize = 32;

/// Clamp the document's `unsatisfied_reason` before it rides into
/// [`RouteAuthError::SelectionMissing`], whose Display reaches tracing, the
/// 409 body, and the UI copy. The document is server-authored, but this is
/// the last hop before shipped logs, so the value is accepted only when it
/// is short and word-shaped: at most [`MAX_UNSATISFIED_REASON_CHARS`], and
/// neither containing `sk-` nor any [`TOKEN_RUN_CHARS`]-long token run.
/// Anything else is treated as absent — the cause-family sentence stands.
fn clamp_unsatisfied_reason(raw: Option<&str>) -> Option<String> {
    let reason = raw.map(str::trim).filter(|reason| !reason.is_empty())?;
    if reason.chars().count() > MAX_UNSATISFIED_REASON_CHARS || looks_token_shaped(reason) {
        return None;
    }
    Some(reason.to_string())
}

fn looks_token_shaped(reason: &str) -> bool {
    if reason.contains("sk-") {
        return true;
    }
    let mut run = 0usize;
    for ch in reason.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            run += 1;
            if run >= TOKEN_RUN_CHARS {
                return true;
            }
        } else {
            run = 0;
        }
    }
    false
}

fn require_field(
    harness_kind: &str,
    value: Option<&str>,
    field: &str,
) -> Result<String, RouteAuthError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RouteAuthError::SelectionIncomplete {
            harness_kind: harness_kind.to_string(),
            detail: format!("source is missing required field '{field}'"),
        })
}

#[cfg(test)]
#[path = "profile_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "profile_redaction_tests.rs"]
mod redaction_tests;
