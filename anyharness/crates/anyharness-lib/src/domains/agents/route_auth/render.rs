//! Launch-time rendering: a resolved [`AgentRuntimeAuthProfile`] → the env
//! vars to set, the env vars to remove, and (where a route needs isolated
//! filesystem state) the on-disk materialization the launcher must perform.
//!
//! Recipes are the live-verified ones from
//! `scripts/agent-gateway-smoke/HARNESS-MATRIX.md` and the hard requirements
//! in spec §13. Rendering the env is pure; writing isolated homes/config files
//! is done by [`super::materialize`], invoked at first launch after a revision
//! change (spec §4 "switch-time").

use std::collections::BTreeMap;
use std::path::Path;

use crate::domains::agents::model::AgentKind;

use super::materialize;
use super::profile::{
    AgentRuntimeAuthProfile, ApiKeyProfile, GatewayProfile, OpenCodeCompositeProfile,
};
use super::RouteAuthError;

/// A sensible default small/fast model for Claude's sidecar calls when the
/// gateway route is active. Versioned so the proxy model_list resolves it (see
/// HARNESS-MATRIX.md §3: the CLI's ambient small-fast model is otherwise not in
/// the gateway config and 400s).
const CLAUDE_DEFAULT_SMALL_FAST_MODEL: &str = "claude-haiku-4-5-20251001";

/// Fallback OpenCode gateway model list used only when the selection carries no
/// `model_catalog` (PR 7 populates it). Mirrors the gateway config's Anthropic
/// entries so a bare launch still resolves at least one model.
const OPENCODE_FALLBACK_MODELS: &[&str] = &[
    "claude-sonnet-4-5",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
];

/// The rendered launch delta for a route-auth profile.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RenderedRouteAuth {
    /// Env vars to inject into the session launch layer.
    pub set: BTreeMap<String, String>,
    /// Env vars to REMOVE from the inherited/ambient spawn env (sanitization).
    /// These are applied last, so they win even against ambient values.
    pub remove: Vec<String>,
}

impl RenderedRouteAuth {
    fn set(&mut self, key: &str, value: impl Into<String>) {
        self.set.insert(key.to_string(), value.into());
    }

    fn remove(&mut self, key: &str) {
        self.remove.push(key.to_string());
    }
}

/// Render the env delta for a resolved profile. `runtime_home` is where
/// isolated harness homes (codex/grok/gemini) are materialized when a route
/// needs them; nothing is written for `Native` or for pure-env routes.
pub fn render_profile(
    profile: &AgentRuntimeAuthProfile,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    match profile {
        AgentRuntimeAuthProfile::Native => Ok(RenderedRouteAuth::default()),
        AgentRuntimeAuthProfile::ApiKey(profile) => render_api_key(profile, runtime_home),
        AgentRuntimeAuthProfile::Gateway(profile) => render_gateway(profile, runtime_home),
        AgentRuntimeAuthProfile::OpenCodeComposite(profile) => {
            render_opencode_composite(profile, runtime_home)
        }
    }
}

/// Render OpenCode's merged multi-slot profile into ONE launch delta
/// (spec §3.3): the gateway slot materializes the injected opencode.json
/// (provider `proliferate` only) exactly like the single-selection gateway
/// route, and each direct provider key rides its plain provider env var.
///
/// Additivity: opencode deep-merges the `OPENCODE_CONFIG` file with the
/// user's own global/project configs (verified against opencode 1.16.2), and
/// per-provider env keys enable providers without any config at all — so our
/// injected sources ADD to, and never replace, the user's local providers.
fn render_opencode_composite(
    profile: &OpenCodeCompositeProfile,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let mut rendered = RenderedRouteAuth::default();
    if let Some(gateway) = &profile.gateway {
        render_opencode_gateway(gateway, runtime_home, &mut rendered)?;
    }
    for key_profile in &profile.provider_keys {
        rendered.set(
            provider_env_key(key_profile.provider.as_deref()),
            &key_profile.key,
        );
    }
    Ok(rendered)
}

fn parse_harness(harness_kind: &str) -> Result<AgentKind, RouteAuthError> {
    AgentKind::parse(harness_kind).ok_or_else(|| RouteAuthError::UnknownHarness {
        harness_kind: harness_kind.to_string(),
    })
}

// ---------------------------------------------------------------------------
// api_key route: raw provider key, direct to provider (no gateway).
// ---------------------------------------------------------------------------

fn render_api_key(
    profile: &ApiKeyProfile,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let kind = parse_harness(&profile.harness_kind)?;
    let mut rendered = RenderedRouteAuth::default();
    match kind {
        AgentKind::Claude => {
            rendered.set("ANTHROPIC_API_KEY", &profile.key);
            set_claude_config_dir(&mut rendered, runtime_home)?;
            sanitize_claude_ambient(&mut rendered);
        }
        AgentKind::Codex => {
            // Codex direct = OpenAI family only in v1 (spec §4 codex note):
            // anthropic-via-codex-direct is out of scope. The provider, when
            // present, must be openai.
            if let Some(provider) = &profile.provider {
                if provider != "openai" {
                    return Err(RouteAuthError::UnsupportedRoute {
                        harness_kind: profile.harness_kind.clone(),
                        detail: format!(
                            "codex api_key route supports only the openai provider in v1 (got '{provider}')"
                        ),
                    });
                }
            }
            rendered.set("OPENAI_API_KEY", &profile.key);
        }
        AgentKind::OpenCode => {
            // Passthrough per-provider env key for direct opencode use.
            rendered.set(provider_env_key(profile.provider.as_deref()), &profile.key);
        }
        AgentKind::Grok => {
            rendered.set("XAI_API_KEY", &profile.key);
        }
        AgentKind::Gemini => {
            rendered.set("GEMINI_API_KEY", &profile.key);
        }
        AgentKind::Cursor => {
            return Err(RouteAuthError::UnsupportedRoute {
                harness_kind: profile.harness_kind.clone(),
                detail: "cursor has no rendered api_key route".to_string(),
            })
        }
    }
    Ok(rendered)
}

/// Map an api_key provider to the env var the harness passthrough reads.
/// Defaults to Anthropic when unspecified (the most common OpenCode direct
/// case).
fn provider_env_key(provider: Option<&str>) -> &'static str {
    match provider {
        Some("openai") => "OPENAI_API_KEY",
        Some("xai") | Some("grok") => "XAI_API_KEY",
        Some("google") | Some("gemini") => "GEMINI_API_KEY",
        _ => "ANTHROPIC_API_KEY",
    }
}

// ---------------------------------------------------------------------------
// gateway route: LiteLLM virtual key + public base URL.
// ---------------------------------------------------------------------------

fn render_gateway(
    profile: &GatewayProfile,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let kind = parse_harness(&profile.harness_kind)?;
    let mut rendered = RenderedRouteAuth::default();
    match kind {
        AgentKind::Claude => render_claude_gateway(profile, runtime_home, &mut rendered)?,
        AgentKind::Codex => render_codex_gateway(profile, runtime_home, &mut rendered)?,
        AgentKind::OpenCode => render_opencode_gateway(profile, runtime_home, &mut rendered)?,
        AgentKind::Grok => render_grok_gateway(profile, runtime_home, &mut rendered)?,
        AgentKind::Gemini => render_gemini_gateway(profile, runtime_home, &mut rendered)?,
        AgentKind::Cursor => {
            return Err(RouteAuthError::UnsupportedRoute {
                harness_kind: profile.harness_kind.clone(),
                detail: "cursor has no gateway route".to_string(),
            })
        }
    }
    Ok(rendered)
}

fn render_claude_gateway(
    profile: &GatewayProfile,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // Claude Code speaks the Anthropic messages API; LiteLLM serves it at the
    // root (the CLI hits POST /v1/messages under ANTHROPIC_BASE_URL).
    rendered.set("ANTHROPIC_BASE_URL", trim_trailing_slash(&profile.base_url));
    rendered.set("ANTHROPIC_AUTH_TOKEN", &profile.key);
    rendered.set(
        "ANTHROPIC_SMALL_FAST_MODEL",
        CLAUDE_DEFAULT_SMALL_FAST_MODEL,
    );
    set_claude_config_dir(rendered, runtime_home)?;
    sanitize_claude_ambient(rendered);
    Ok(())
}

/// Point CLAUDE_CONFIG_DIR at an isolated dir (materialized) so the CLI does not
/// read an ambient `~/.claude` that could carry stale provider/auth settings and
/// defeat the env sanitization below (HARNESS-MATRIX claude recipe). Applies to
/// both the gateway and api_key claude routes.
fn set_claude_config_dir(
    rendered: &mut RenderedRouteAuth,
    runtime_home: &Path,
) -> Result<(), RouteAuthError> {
    let config_dir = materialize::materialize_claude_config_dir(runtime_home)?;
    rendered.set(
        "CLAUDE_CONFIG_DIR",
        config_dir.to_string_lossy().into_owned(),
    );
    Ok(())
}

/// HARD REQUIREMENT (spec §13.3 / HARNESS-MATRIX.md §claude): ambient provider
/// env silently reroutes the Claude CLI (observed: Bedrock). Remove the
/// rerouting flags and any Anthropic base-url/token/key we did NOT just set, so
/// the selected route's credentials are authoritative. Removal wins over
/// inherited values (applied last at spawn); we do not just set empties because
/// the CLI treats a present-but-empty flag inconsistently.
///
/// - gateway route: SET base-url + auth-token → those are kept; ANTHROPIC_API_KEY
///   is removed (an ambient raw key must not shadow the gateway token).
/// - api_key route: SET ANTHROPIC_API_KEY → it is kept; ambient ANTHROPIC_AUTH_TOKEN
///   and ANTHROPIC_BASE_URL are removed (they would reroute the CLI away from the
///   selected key / provider).
fn sanitize_claude_ambient(rendered: &mut RenderedRouteAuth) {
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "AWS_BEARER_TOKEN_BEDROCK",
    ] {
        rendered.remove(key);
    }
    // Remove each Anthropic selector we didn't explicitly set on this route, so
    // ambient values can't shadow the chosen credential path.
    for key in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
    ] {
        if !rendered.set.contains_key(key) {
            rendered.remove(key);
        }
    }
}

fn render_codex_gateway(
    profile: &GatewayProfile,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // Isolated CODEX_HOME with a config.toml pointing at the proliferate
    // provider (wire_api=responses). The provider config references
    // PROLIFERATE_GATEWAY_KEY via env_key, so no `codex login` is needed.
    let codex_home = materialize::materialize_codex_home(runtime_home, profile)?;
    rendered.set("CODEX_HOME", codex_home.to_string_lossy().into_owned());
    rendered.set("PROLIFERATE_GATEWAY_KEY", &profile.key);
    // Ambient direct-provider keys would let the CLI bypass the provider
    // config; drop them so the gateway provider is authoritative.
    rendered.remove("OPENAI_API_KEY");
    rendered.remove("ANTHROPIC_API_KEY");
    Ok(())
}

fn render_opencode_gateway(
    profile: &GatewayProfile,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    let models = profile
        .model_catalog
        .clone()
        .filter(|models| !models.is_empty())
        .unwrap_or_else(|| {
            OPENCODE_FALLBACK_MODELS
                .iter()
                .map(|model| model.to_string())
                .collect()
        });
    // opencode reads config from an explicit file path via OPENCODE_CONFIG.
    // We materialize opencode.json (provider proliferate, openai-compatible,
    // baseURL, apiKey {env:PROLIFERATE_GATEWAY_KEY}, explicit models map) into
    // an isolated dir and point OPENCODE_CONFIG at it. See materialize.rs.
    let config_path = materialize::materialize_opencode_config(runtime_home, profile, &models)?;
    // The isolated dir holding opencode.json plus the XDG subdirs materialized
    // beside it. Point XDG_CONFIG_HOME/XDG_DATA_HOME there so opencode cannot
    // reach the user's global config/auth (HARNESS-MATRIX opencode recipe).
    if let Some(config_dir) = config_path.parent() {
        rendered.set(
            "XDG_CONFIG_HOME",
            config_dir
                .join(materialize::OPENCODE_XDG_CONFIG_SUBDIR)
                .to_string_lossy()
                .into_owned(),
        );
        rendered.set(
            "XDG_DATA_HOME",
            config_dir
                .join(materialize::OPENCODE_XDG_DATA_SUBDIR)
                .to_string_lossy()
                .into_owned(),
        );
    }
    rendered.set(
        "OPENCODE_CONFIG",
        config_path.to_string_lossy().into_owned(),
    );
    rendered.set("PROLIFERATE_GATEWAY_KEY", &profile.key);
    Ok(())
}

fn render_grok_gateway(
    profile: &GatewayProfile,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    let grok_home = materialize::materialize_grok_home(runtime_home, profile)?;
    rendered.set("HOME", grok_home.to_string_lossy().into_owned());
    rendered.set(
        "GROK_MODELS_BASE_URL",
        format!("{}/v1", trim_trailing_slash(&profile.base_url)),
    );
    rendered.set("XAI_API_KEY", &profile.key);
    Ok(())
}

fn render_gemini_gateway(
    profile: &GatewayProfile,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // ROOT /v1beta genai facade — GOOGLE_GEMINI_BASE_URL is the proxy root, no
    // /gemini prefix (HARNESS-MATRIX.md §gemini). Isolated home carries
    // settings.json selectedType=gemini-api-key.
    let gemini_home = materialize::materialize_gemini_home(runtime_home, profile)?;
    rendered.set("HOME", gemini_home.to_string_lossy().into_owned());
    rendered.set(
        "GOOGLE_GEMINI_BASE_URL",
        trim_trailing_slash(&profile.base_url).to_string(),
    );
    rendered.set("GEMINI_API_KEY", &profile.key);
    rendered.set("GEMINI_CLI_TRUST_WORKSPACE", "true");
    Ok(())
}

fn trim_trailing_slash(url: &str) -> &str {
    url.trim_end_matches('/')
}
