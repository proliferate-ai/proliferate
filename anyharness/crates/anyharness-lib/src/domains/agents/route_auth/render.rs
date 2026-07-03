//! Launch-time rendering: a resolved [`AgentRuntimeAuthProfile`] → the env vars
//! to set, the env vars to remove, and the on-disk config files the launcher
//! must materialize (two-phase, contract §4).
//!
//! Rendering is PURE: [`render_profile`] performs no filesystem I/O. It returns
//! a [`RenderedRouteAuth`] whose `files` describe the isolated config the
//! launcher writes afterward (via [`super::materialize`], keeping the
//! revision-dir naming + conservative GC unchanged). Isolated-home paths are
//! computed by deterministic path joins so the env vars and the `files` agree
//! without touching disk.
//!
//! Composition is additive: `api_key` sources set exactly their free-form env
//! var; `gateway` sources run the per-harness recipe (the live-verified ones
//! from `scripts/agent-gateway-smoke/HARNESS-MATRIX.md`).

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::json;

use crate::domains::agents::model::AgentKind;

use super::materialize::{self, FileSpec, PathFamily};
use super::plan::GatewayModelPlan;
use super::profile::{AgentRuntimeAuthProfile, GatewayProfile, HarnessSources, ResolvedSource};
use super::RouteAuthError;

/// The rendered launch delta for a route-auth profile (two-phase, contract §4).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RenderedRouteAuth {
    /// Env vars to inject into the session launch layer.
    pub set: BTreeMap<String, String>,
    /// Env vars to REMOVE from the inherited/ambient spawn env (sanitization).
    /// These are applied last, so they win even against ambient values.
    pub remove: Vec<String>,
    /// Isolated config files the launcher must write after render. Pure data:
    /// producing this list touches no disk (contract §4 two-phase render).
    pub files: Vec<FileSpec>,
}

impl RenderedRouteAuth {
    fn set(&mut self, key: &str, value: impl Into<String>) {
        self.set.insert(key.to_string(), value.into());
    }

    fn remove(&mut self, key: &str) {
        self.remove.push(key.to_string());
    }
}

/// Render the launch delta for a resolved profile. PURE: no filesystem I/O —
/// isolated-config paths are computed by deterministic joins and the writes are
/// described in [`RenderedRouteAuth::files`] for the launcher to apply.
pub fn render_profile(
    profile: &AgentRuntimeAuthProfile,
    plan: &GatewayModelPlan,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    match profile {
        AgentRuntimeAuthProfile::Native => Ok(RenderedRouteAuth::default()),
        AgentRuntimeAuthProfile::Sources(sources) => render_sources(sources, plan, runtime_home),
    }
}

/// Compose a harness's enabled sources into one additive launch delta. Each
/// `api_key` source rides its free-form env var; each `gateway` source runs the
/// per-harness recipe (consuming the catalog-resolved [`GatewayModelPlan`] for
/// model values, spec §3). The server validated legality, so ordering/count are
/// trusted here.
fn render_sources(
    sources: &HarnessSources,
    plan: &GatewayModelPlan,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let mut rendered = RenderedRouteAuth::default();
    for source in &sources.sources {
        match source {
            ResolvedSource::ApiKey(profile) => {
                // Fully generic: set exactly the requested var (contract §4).
                rendered.set(&profile.env_var_name, &profile.value);
                // Codex authenticates from CODEX_HOME/auth.json, NOT the bare env
                // var, on the ACP session/load (resume) path — a route-authed
                // sandbox resume of a MIGRATED codex session otherwise fails
                // "Authentication required". The api_key route does not repoint
                // CODEX_HOME (it stays the session-layer codex-local home, where
                // portability::codex::install_codex_artifacts also lands the
                // migrated rollout), so describe an auth.json write into that
                // home. Pure: the bytes are built here; the launcher applies the
                // FileSpec (mod.rs after render_profile).
                if matches!(parse_harness(&sources.harness_kind), Ok(AgentKind::Codex)) {
                    rendered.files.push(FileSpec {
                        path_family: PathFamily::CodexLocalAuth,
                        revision: sources.revision,
                        contents: Some(codex_api_key_auth_json(&profile.value)),
                    });
                }
            }
            ResolvedSource::Gateway(profile) => render_gateway(
                &sources.harness_kind,
                profile,
                plan,
                sources.revision,
                runtime_home,
                &mut rendered,
            )?,
        }
    }
    Ok(rendered)
}

fn parse_harness(harness_kind: &str) -> Result<AgentKind, RouteAuthError> {
    AgentKind::parse(harness_kind).ok_or_else(|| RouteAuthError::UnknownHarness {
        harness_kind: harness_kind.to_string(),
    })
}

// ---------------------------------------------------------------------------
// gateway route: LiteLLM virtual key + public base URL, per-harness recipe.
// ---------------------------------------------------------------------------

fn render_gateway(
    harness_kind: &str,
    profile: &GatewayProfile,
    plan: &GatewayModelPlan,
    revision: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    let kind = parse_harness(harness_kind)?;
    match kind {
        AgentKind::Claude => render_claude_gateway(profile, plan, revision, runtime_home, rendered),
        AgentKind::Codex => {
            render_codex_gateway(harness_kind, profile, plan, revision, runtime_home, rendered)
        }
        AgentKind::OpenCode => {
            render_opencode_gateway(harness_kind, profile, plan, revision, runtime_home, rendered)
        }
        AgentKind::Grok => render_grok_gateway(profile, revision, runtime_home, rendered),
        AgentKind::Cursor => Err(RouteAuthError::UnsupportedRoute {
            harness_kind: harness_kind.to_string(),
            detail: "cursor has no gateway route".to_string(),
        }),
    }
}

fn render_claude_gateway(
    profile: &GatewayProfile,
    plan: &GatewayModelPlan,
    revision: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // Claude Code speaks the Anthropic messages API; LiteLLM serves it at the
    // root (the CLI hits POST /v1/messages under ANTHROPIC_BASE_URL).
    rendered.set("ANTHROPIC_BASE_URL", trim_trailing_slash(&profile.base_url));
    rendered.set("ANTHROPIC_AUTH_TOKEN", &profile.key);
    // Small/fast sidecar model: the catalog's `gatewayPolicy.roles.small_fast`
    // pin (HARNESS-MATRIX.md §3: the CLI's ambient small-fast model is otherwise
    // not in the gateway config and 400s). Skip the var entirely when the
    // catalog carries no pin — an absent override lets the CLI use its default.
    if let Some(small_fast) = plan.small_fast_model.as_deref() {
        rendered.set("ANTHROPIC_SMALL_FAST_MODEL", small_fast);
    }
    // Point CLAUDE_CONFIG_DIR at an isolated dir (materialized) so the CLI does
    // not read an ambient `~/.claude` that could carry stale provider/auth
    // settings and defeat the env sanitization below. Not revision-keyed — it
    // holds no revision-specific content; the launch env is authoritative.
    let config_dir = materialize::claude_config_dir_path(runtime_home);
    rendered.set("CLAUDE_CONFIG_DIR", path_string(&config_dir));
    rendered.files.push(FileSpec {
        path_family: PathFamily::ClaudeConfig,
        revision,
        contents: None,
    });
    sanitize_claude_ambient(rendered);
    Ok(())
}

/// HARD REQUIREMENT (HARNESS-MATRIX.md §claude): ambient provider env silently
/// reroutes the Claude CLI (observed: Bedrock). Remove the rerouting flags and
/// any Anthropic base-url/token/key we did NOT just set, so the gateway
/// credentials are authoritative. Removal wins over inherited values (applied
/// last at spawn); we do not just set empties because the CLI treats a
/// present-but-empty flag inconsistently.
///
/// The rules key off which vars THIS render set, not off providers: the gateway
/// route sets base-url + auth-token → those are kept; ambient ANTHROPIC_API_KEY
/// is removed so a raw key cannot shadow the gateway token.
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
    harness_kind: &str,
    profile: &GatewayProfile,
    plan: &GatewayModelPlan,
    revision: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // Codex refuses to launch without a `model` and otherwise falls back to a
    // codex-native id the gateway cannot serve, so the catalog MUST carry the
    // gateway default (`defaults["gateway"]`, spec §3). Error rather than write
    // a config the CLI will reject.
    let default_model = plan.default_model.as_deref().ok_or_else(|| {
        RouteAuthError::SelectionIncomplete {
            harness_kind: harness_kind.to_string(),
            detail: "codex gateway requires a default model from the catalog \
                     gatewayPolicy (defaults[\"gateway\"])"
                .to_string(),
        }
    })?;
    // Isolated CODEX_HOME with a config.toml pointing at the proliferate
    // provider (wire_api=responses). The provider config references
    // PROLIFERATE_GATEWAY_KEY via env_key, so no `codex login` is needed.
    let codex_home = materialize::revision_dir_path(
        runtime_home,
        materialize::CODEX_HOME_PREFIX,
        revision,
    );
    rendered.set("CODEX_HOME", path_string(&codex_home));
    rendered.set("PROLIFERATE_GATEWAY_KEY", &profile.key);
    // Ambient direct-provider keys would let the CLI bypass the provider
    // config; drop them so the gateway provider is authoritative.
    rendered.remove("OPENAI_API_KEY");
    rendered.remove("ANTHROPIC_API_KEY");
    rendered.files.push(FileSpec {
        path_family: PathFamily::CodexHome,
        revision,
        contents: Some(codex_config_toml(&profile.base_url, default_model).into_bytes()),
    });
    Ok(())
}

/// Build the codex gateway config.toml. Written by hand (small, deterministic)
/// so the snapshot test can assert exact content without a toml serializer. The
/// `default_model` is the catalog-resolved gateway default (spec §3), never a
/// Rust constant.
/// The codex api-key `auth.json` bytes: `{ "OPENAI_API_KEY": "<key>" }`, the
/// shape `codex login --with-api-key` writes and credential-discovery
/// `has_codex_api_key` reads. serde_json handles string escaping so an arbitrary
/// key value is safe.
fn codex_api_key_auth_json(api_key: &str) -> Vec<u8> {
    let auth = serde_json::json!({ "OPENAI_API_KEY": api_key });
    // to_vec_pretty on a fixed one-key object is infallible; fall back to a
    // hand-built object rather than panicking if that ever changes.
    serde_json::to_vec_pretty(&auth).unwrap_or_else(|_| {
        format!("{{\n  \"OPENAI_API_KEY\": {}\n}}\n", json_string(api_key)).into_bytes()
    })
}

/// Minimal JSON string escaper for the infallible-fallback path above.
fn json_string(value: &str) -> String {
    serde_json::Value::String(value.to_string()).to_string()
}

fn codex_config_toml(base_url: &str, default_model: &str) -> String {
    let base_url = format!("{}/v1", trim_trailing_slash(base_url));
    format!(
        "model_provider = \"proliferate\"\n\
         model = \"{default_model}\"\n\
         \n\
         [model_providers.proliferate]\n\
         name = \"Proliferate Gateway\"\n\
         base_url = \"{base_url}\"\n\
         env_key = \"PROLIFERATE_GATEWAY_KEY\"\n\
         wire_api = \"responses\"\n"
    )
}

fn render_opencode_gateway(
    harness_kind: &str,
    profile: &GatewayProfile,
    plan: &GatewayModelPlan,
    revision: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // opencode requires an explicit models map in-config; the catalog-resolved
    // plan supplies it (latest probe rows else gatewayPolicy.seedModels, spec
    // §3). An empty list means the harness has no launchable model — error
    // rather than write a config with an empty provider.
    if plan.models.is_empty() {
        return Err(RouteAuthError::SelectionIncomplete {
            harness_kind: harness_kind.to_string(),
            detail: "opencode gateway requires at least one model (catalog \
                     gatewayPolicy.seedModels or a live gateway probe)"
                .to_string(),
        });
    }
    // opencode reads config from an explicit file path via OPENCODE_CONFIG. We
    // materialize opencode.json (provider proliferate, openai-compatible,
    // baseURL, apiKey {env:PROLIFERATE_GATEWAY_KEY}, explicit models map) into
    // an isolated dir and point OPENCODE_CONFIG at it.
    let config_dir = materialize::revision_dir_path(
        runtime_home,
        materialize::OPENCODE_CONFIG_PREFIX,
        revision,
    );
    // Isolate XDG so opencode cannot reach the user's global config/auth
    // (HARNESS-MATRIX opencode recipe: XDG_CONFIG_HOME/XDG_DATA_HOME isolated).
    rendered.set(
        "XDG_CONFIG_HOME",
        path_string(&config_dir.join(materialize::OPENCODE_XDG_CONFIG_SUBDIR)),
    );
    rendered.set(
        "XDG_DATA_HOME",
        path_string(&config_dir.join(materialize::OPENCODE_XDG_DATA_SUBDIR)),
    );
    rendered.set(
        "OPENCODE_CONFIG",
        path_string(&config_dir.join(materialize::OPENCODE_CONFIG_FILE_NAME)),
    );
    rendered.set("PROLIFERATE_GATEWAY_KEY", &profile.key);
    rendered.files.push(FileSpec {
        path_family: PathFamily::OpencodeConfig,
        revision,
        contents: Some(opencode_config_json(&profile.base_url, &plan.models)?),
    });
    Ok(())
}

/// Build the opencode gateway config JSON. The models map is the catalog-resolved
/// plan list (latest probe rows else `gatewayPolicy.seedModels`, spec §3), never
/// a Rust constant. Contains ONLY our provider so opencode's config-layer merge
/// ADDS it to the user's own local providers.
fn opencode_config_json(base_url: &str, models: &[String]) -> Result<Vec<u8>, RouteAuthError> {
    let base_url = format!("{}/v1", trim_trailing_slash(base_url));
    let models_map: serde_json::Map<String, serde_json::Value> = models
        .iter()
        .map(|model| (model.clone(), json!({})))
        .collect();
    let config = json!({
        "provider": {
            "proliferate": {
                "npm": "@ai-sdk/openai-compatible",
                "options": {
                    "baseURL": base_url,
                    "apiKey": "{env:PROLIFERATE_GATEWAY_KEY}"
                },
                "models": models_map
            }
        }
    });
    serde_json::to_vec_pretty(&config).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to serialize opencode config: {error}"),
    })
}

fn render_grok_gateway(
    profile: &GatewayProfile,
    revision: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    let grok_home =
        materialize::revision_dir_path(runtime_home, materialize::GROK_HOME_PREFIX, revision);
    rendered.set("HOME", path_string(&grok_home));
    rendered.set(
        "GROK_MODELS_BASE_URL",
        format!("{}/v1", trim_trailing_slash(&profile.base_url)),
    );
    rendered.set("XAI_API_KEY", &profile.key);
    rendered.files.push(FileSpec {
        path_family: PathFamily::GrokHome,
        revision,
        contents: None,
    });
    Ok(())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn trim_trailing_slash(url: &str) -> &str {
    url.trim_end_matches('/')
}
