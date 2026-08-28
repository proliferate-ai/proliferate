//! Launch-time rendering: a resolved [`AgentRuntimeAuthProfile`] → the env vars
//! to set, the env vars to remove, and the on-disk config files the launcher
//! must materialize (two-phase, contract §4).
//!
//! Rendering is PURE: [`render_profile`] performs no filesystem I/O. It returns
//! a [`RenderedRouteAuth`] whose `files` describe the isolated config the
//! launcher writes afterward (via [`super::materialize`], keeping the
//! sequence-dir naming + conservative GC unchanged). Isolated-home paths are
//! computed by deterministic path joins so the env vars and the `files` agree
//! without touching disk.
//!
//! Composition is additive: `api_key` sources set exactly their free-form env
//! var; `gateway` sources run the per-harness recipe (the live-verified ones
//! from `scripts/agent-gateway-smoke/HARNESS-MATRIX.md`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::json;

use crate::domains::agents::model::AgentKind;

use super::materialize::{self, FileSpec, PathFamily};
use super::plan::GatewayModelPlan;
use super::profile::{
    AgentRuntimeAuthProfile, GatewayProfile, HarnessSources, ProviderConfigProfile, ResolvedSource,
    SeatProfile,
};
use super::sanitize::sanitize_claude_if_routed;
use super::RouteAuthError;

/// The rendered launch delta for a route-auth profile (two-phase, contract §4). `Debug` is hand-written in `redact.rs`: `set`'s values are credentials.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct RenderedRouteAuth {
    /// Env vars to inject into the session launch layer.
    pub set: BTreeMap<String, String>,
    /// Env vars to REMOVE from the inherited/ambient spawn env (sanitization).
    /// These are applied last, so they win even against ambient values.
    pub remove: Vec<String>,
    /// Isolated config files the launcher must write after render. Pure data:
    /// producing this list touches no disk (contract §4 two-phase render).
    pub files: Vec<FileSpec>,
    /// The vault seat id the seat render arm actually rendered (never token
    /// material), so the launch can record which seat served on a successful
    /// spawn. Data only — `None` for every non-seat route.
    pub serving_seat_id: Option<String>,
}

impl RenderedRouteAuth {
    fn set(&mut self, key: &str, value: impl Into<String>) {
        self.set.insert(key.to_string(), value.into());
    }

    pub(super) fn remove(&mut self, key: &str) {
        self.remove.push(key.to_string());
    }

    /// Set a key AND record its name in `recorded`. Used only by the
    /// `provider_config` arm, so `sanitize::sanitize_claude_ambient` can tell a
    /// rerouting flag THAT ARM composed (which it must keep — the flag IS the
    /// route) from an arbitrary, user-named `api_key` var that merely collides
    /// with one (which it must still strip). See that fn's doc for why the
    /// distinction is load-bearing.
    fn set_recorded(
        &mut self,
        recorded: &mut BTreeSet<String>,
        key: &str,
        value: impl Into<String>,
    ) {
        self.set(key, value);
        recorded.insert(key.to_string());
    }
}

/// Render the launch delta for a resolved profile. PURE: no filesystem I/O —
/// isolated-config paths are computed by deterministic joins and the writes are
/// described in [`RenderedRouteAuth::files`] for the launcher to apply.
///
/// `harness_kind` is validated even for [`AgentRuntimeAuthProfile::Native`]. A
/// native profile always renders an empty delta: the harness's own login and
/// configuration remain authoritative. Model and control intent travel through
/// the session launch/configuration path, not route-auth materialization.
pub fn render_profile(
    profile: &AgentRuntimeAuthProfile,
    harness_kind: &str,
    plan: &GatewayModelPlan,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    match profile {
        AgentRuntimeAuthProfile::Native => {
            parse_harness(harness_kind)?;
            Ok(RenderedRouteAuth::default())
        }
        AgentRuntimeAuthProfile::Sources(sources) => render_sources(sources, plan, runtime_home),
    }
}

fn render_sources(
    sources: &HarnessSources,
    plan: &GatewayModelPlan,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let mut rendered = RenderedRouteAuth::default();
    // The env var names the `provider_config` arm composed. Kept separate from
    // `rendered.set` because only THIS arm's names may exempt a claude rerouting
    // flag from sanitization — see `sanitize_claude_ambient`.
    let mut provider_config_keys: BTreeSet<String> = BTreeSet::new();
    // The rotated launch seam (mod.rs) filters the pool to the ONE chosen
    // seat before render, so a launch profile reaching here carries at most
    // one. Unrotated callers (probe/readiness/materialization) still hand the
    // full pool over, and first-seat-wins stays as their deterministic
    // behavior — composing more than one seat would let a later token
    // overwrite the serving one's, so extras are skipped regardless.
    let mut seat_applied = false;
    for source in &sources.sources {
        match source {
            ResolvedSource::ApiKey(profile) => {
                // Fully generic: set exactly the requested var (contract §4).
                // NOT recorded as a provider_config key: the name is user-chosen
                // and must stay subject to claude's ambient strip list.
                rendered.set(&profile.env_var_name, &profile.value);
            }
            ResolvedSource::Gateway(profile) => render_gateway(
                &sources.harness_kind,
                profile,
                plan,
                sources.sequence,
                runtime_home,
                &mut rendered,
            )?,
            ResolvedSource::ProviderConfig(profile) => render_provider_config(
                &sources.harness_kind,
                profile,
                plan,
                sources.sequence,
                runtime_home,
                &mut rendered,
                &mut provider_config_keys,
            )?,
            ResolvedSource::Seat(profile) => {
                if seat_applied {
                    continue;
                }
                render_seat(&sources.harness_kind, profile, runtime_home, &mut rendered)?;
                seat_applied = true;
            }
        }
    }
    // Every non-native route, not just the gateway one. See the fn's doc for the
    // reverse-contamination case this closes. Must run AFTER provider_config
    // composes too, so a claude provider_config source's mode-switch flag
    // (e.g. CLAUDE_CODE_USE_BEDROCK) is in `provider_config_keys` and kept,
    // rather than stripped as stale ambient state.
    sanitize_claude_if_routed(&sources.harness_kind, &mut rendered, &provider_config_keys);
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
    sequence: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    let kind = parse_harness(harness_kind)?;
    match kind {
        AgentKind::Claude => render_claude_gateway(profile, plan, sequence, runtime_home, rendered),
        AgentKind::Codex => render_codex_gateway(
            harness_kind,
            profile,
            plan,
            sequence,
            runtime_home,
            rendered,
        ),
        AgentKind::OpenCode => render_opencode_gateway(
            harness_kind,
            profile,
            plan,
            sequence,
            runtime_home,
            rendered,
        ),
        AgentKind::Grok => render_grok_gateway(profile, sequence, runtime_home, rendered),
        AgentKind::Cursor => Err(RouteAuthError::UnsupportedRoute {
            harness_kind: harness_kind.to_string(),
            detail: "cursor has no gateway route".to_string(),
        }),
    }
}

fn render_claude_gateway(
    profile: &GatewayProfile,
    plan: &GatewayModelPlan,
    sequence: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // Claude Code speaks the Anthropic messages API; LiteLLM serves it at the
    // root (the CLI hits POST /v1/messages under ANTHROPIC_BASE_URL).
    rendered.set("ANTHROPIC_BASE_URL", trim_trailing_slash(&profile.base_url));
    rendered.set("ANTHROPIC_AUTH_TOKEN", &profile.key);
    let _ = plan;
    // Point CLAUDE_CONFIG_DIR at an isolated dir (materialized) so the CLI does
    // not read an ambient `~/.claude` that could carry stale provider/auth
    // settings and defeat the env sanitization below. Not sequence-keyed — it
    // holds no sequence-specific content; the launch env is authoritative.
    let config_dir = materialize::claude_config_dir_path(runtime_home);
    rendered.set("CLAUDE_CONFIG_DIR", path_string(&config_dir));
    rendered.files.push(FileSpec {
        path_family: PathFamily::ClaudeConfig,
        sequence,
        contents: None,
    });
    // Sanitization is applied once for the whole composed delta by
    // `render_sources` (`sanitize_claude_if_routed`), not per-recipe — see that
    // fn for why the composed view is required.
    Ok(())
}

fn render_codex_gateway(
    harness_kind: &str,
    profile: &GatewayProfile,
    plan: &GatewayModelPlan,
    sequence: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    let _ = (harness_kind, plan);
    // Isolated CODEX_HOME with a config.toml pointing at the proliferate
    // provider (wire_api=responses). The provider config references
    // PROLIFERATE_GATEWAY_KEY via env_key, so no `codex login` is needed.
    let codex_home =
        materialize::sequence_dir_path(runtime_home, materialize::CODEX_HOME_PREFIX, sequence);
    rendered.set("CODEX_HOME", path_string(&codex_home));
    rendered.set("PROLIFERATE_GATEWAY_KEY", &profile.key);
    // Ambient direct-provider keys would let the CLI bypass the provider
    // config; drop them so the gateway provider is authoritative.
    rendered.remove("OPENAI_API_KEY");
    rendered.remove("ANTHROPIC_API_KEY");
    rendered.files.push(FileSpec {
        path_family: PathFamily::CodexHome,
        sequence,
        contents: Some(
            codex_config_toml(CodexConfigRecipe::Gateway {
                base_url: &profile.base_url,
            })
            .into_bytes(),
        ),
    });
    Ok(())
}

/// Which codex configuration a launch needs. One enum rather than one function
/// per route so every codex `config.toml` in the system is emitted by
/// [`codex_config_toml`] below — the property that keeps the variants
/// comparable and stops a new route from inventing its own TOML.
///
/// Track D (typed provider configs) adds two variants:
/// - `Bedrock` → `model_provider = "amazon-bedrock"`,
///   codex's BUILT-IN upstream provider, so NO `[model_providers.*]` block at
///   all — the one variant that adds a provider without adding a table
///   The launch-options probe may use its own temporary provider table for
///   `/v1/responses` enumeration; that is probe scaffolding, not Codex's launch
///   configuration.
///   `region`/credential ride as plain env from `profile.env`, never
///   interpolated into the TOML body.
/// - `Azure { base_url, deployment, env_key }` → a `[model_providers.azure]`
///   block with `wire_api = "responses"` (Azure OpenAI's Responses-API-
///   compatible surface) and `env_key` naming the vault-supplied credential
///   var, mirroring the gateway recipe's `env_key = "PROLIFERATE_GATEWAY_KEY"`
///   pattern. **UNVERIFIED** (brief §5/§8 item 2): nobody has live-tested
///   codex against real Azure OpenAI, and the registry's `pending` flag on
///   codex×azure_openai stays `true` until Gate 4 passes — this arm exists so
///   the eventual flip is a one-line registry change, not a code change.
///
/// Adding either is a new arm here plus a new `ResolvedSource::ProviderConfig`
/// arm in `render_sources`; no existing arm changes.
enum CodexConfigRecipe<'a> {
    /// The managed gateway: a custom OpenAI-compatible provider whose key comes
    /// from `PROLIFERATE_GATEWAY_KEY` in the launch env.
    Gateway { base_url: &'a str },
    /// Track D: the user's own AWS Bedrock account, via codex's built-in
    /// `amazon-bedrock` provider. The harness owns its no-override default.
    Bedrock,
    /// Track D, UNVERIFIED (see enum doc): the user's own Azure OpenAI
    /// account via codex's `[model_providers.azure]` config.toml injection.
    Azure {
        base_url: &'a str,
        deployment: &'a str,
        env_key: &'a str,
    },
}

/// Build a codex `config.toml`. Written by hand (small, deterministic) so the
/// snapshot tests can assert exact content without a toml serializer.
///
/// The route selects a provider only. It does not author an executable model.
fn codex_config_toml(recipe: CodexConfigRecipe<'_>) -> String {
    match recipe {
        CodexConfigRecipe::Gateway { base_url } => {
            let base_url = format!("{}/v1", trim_trailing_slash(base_url));
            format!(
                "model_provider = \"proliferate\"\n\
                 \n\
                 [model_providers.proliferate]\n\
                 name = \"Proliferate Gateway\"\n\
                 base_url = \"{base_url}\"\n\
                 env_key = \"PROLIFERATE_GATEWAY_KEY\"\n\
                 wire_api = \"responses\"\n"
            )
        }
        CodexConfigRecipe::Bedrock => {
            // codex's BUILT-IN amazon-bedrock upstream: no [model_providers.*]
            // table at all. Credential + region ride as plain env from
            // profile.env, set by the caller — never interpolated here.
            "model_provider = \"amazon-bedrock\"\n".to_string()
        }
        CodexConfigRecipe::Azure {
            base_url,
            deployment,
            env_key,
        } => {
            // UNVERIFIED (see CodexConfigRecipe::Azure's doc) -- built so the
            // eventual registry flip is a one-line change, not a code change.
            // The deployment name is the model selector for Azure OpenAI.
            format!(
                "model_provider = \"azure\"\n\
                 model = \"{deployment}\"\n\
                 \n\
                 [model_providers.azure]\n\
                 name = \"Azure OpenAI\"\n\
                 base_url = \"{base_url}\"\n\
                 env_key = \"{env_key}\"\n\
                 wire_api = \"responses\"\n"
            )
        }
    }
}

fn render_opencode_gateway(
    harness_kind: &str,
    profile: &GatewayProfile,
    plan: &GatewayModelPlan,
    sequence: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // opencode requires an explicit models map in-config; only a live gateway
    // observation may supply it. An empty list means the route cannot launch — error
    // rather than write a config with an empty provider.
    if plan.models.is_empty() {
        return Err(RouteAuthError::SelectionIncomplete {
            harness_kind: harness_kind.to_string(),
            detail: "opencode gateway requires a live target model observation".to_string(),
        });
    }
    // opencode reads config from an explicit file path via OPENCODE_CONFIG. We
    // materialize opencode.json (provider proliferate, openai-compatible,
    // baseURL, apiKey {env:PROLIFERATE_GATEWAY_KEY}, explicit models map) into
    // an isolated dir and point OPENCODE_CONFIG at it.
    let config_dir =
        materialize::sequence_dir_path(runtime_home, materialize::OPENCODE_CONFIG_PREFIX, sequence);
    // Isolate XDG_CONFIG_HOME so opencode reads OUR injected provider config
    // (sequence-keyed, deterministic) rather than the user's global
    // ~/.config/opencode. XDG_DATA_HOME is intentionally LEFT AMBIENT so that
    // opencode resolves auth at the real ~/.local/share/opencode/auth.json —
    // this lets natively-logged-in providers (via `opencode auth login`)
    // coexist with the injected proliferate provider and any api_key env
    // sources. The config-layer merge design ("ADDS it to the user's own
    // providers") only works when the auth file is reachable.
    rendered.set(
        "XDG_CONFIG_HOME",
        path_string(&config_dir.join(materialize::OPENCODE_XDG_CONFIG_SUBDIR)),
    );
    rendered.set(
        "OPENCODE_CONFIG",
        path_string(&config_dir.join(materialize::OPENCODE_CONFIG_FILE_NAME)),
    );
    rendered.set("PROLIFERATE_GATEWAY_KEY", &profile.key);
    rendered.files.push(FileSpec {
        path_family: PathFamily::OpencodeConfig,
        sequence,
        contents: Some(opencode_config_json(&profile.base_url, &plan.models)?),
    });
    Ok(())
}

/// Build the opencode gateway config JSON. The models map is the exact live
/// gateway list, never a seed or Rust constant. Contains ONLY our provider so opencode's config-layer merge
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
    sequence: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    let grok_home =
        materialize::sequence_dir_path(runtime_home, materialize::GROK_HOME_PREFIX, sequence);
    rendered.set("HOME", path_string(&grok_home));
    rendered.set(
        "GROK_MODELS_BASE_URL",
        format!("{}/v1", trim_trailing_slash(&profile.base_url)),
    );
    rendered.set("XAI_API_KEY", &profile.key);
    rendered.files.push(FileSpec {
        path_family: PathFamily::GrokHome,
        sequence,
        contents: None,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// seat route (seats v1): "run on this Max subscription". claude only this
// slice — codex's seat route is the phase-2 refreshing-file shape.
// ---------------------------------------------------------------------------

/// The claude seat recipe (agent_auth spec §4 cell 2, "claude · seat"): env
/// only — set the already-resolved seat env (`CLAUDE_CODE_OAUTH_TOKEN`) plus
/// `CLAUDE_CONFIG_DIR` → that seat's own dir (`claude-config-<seat>/`), which
/// neutralizes `apiKeyHelper` and ambient settings and keeps the CLI's
/// keychain state per-seat (config-dir-hashed service names — the live-proven
/// per-seat coexistence of 2026-08-26).
///
/// The strip list — `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`/
/// `ANTHROPIC_BASE_URL` plus the rerouting flags — is applied by
/// [`sanitize_claude_ambient`] over the composed delta, exactly as for every
/// other non-native claude route: the seat env keys are deliberately NOT
/// recorded as provider-config keys, so no rerouting flag survives, and none
/// of the three Anthropic selectors is set by this recipe, so all three are
/// removed. `CLAUDE_CODE_OAUTH_TOKEN` is not on the strip list — it IS the
/// route.
fn render_seat(
    harness_kind: &str,
    profile: &SeatProfile,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    match parse_harness(harness_kind)? {
        AgentKind::Claude => {
            for (key, value) in &profile.env {
                rendered.set(key, value);
            }
            let seat_dir = materialize::claude_seat_config_dir_path(runtime_home, &profile.seat_id);
            rendered.set("CLAUDE_CONFIG_DIR", path_string(&seat_dir));
            rendered.files.push(FileSpec {
                path_family: PathFamily::ClaudeSeatConfig {
                    seat_id: profile.seat_id.clone(),
                },
                sequence: 0,
                contents: None,
            });
            // The serving-seat channel (data only): the seat this arm actually
            // rendered, for confirm_served on a successful spawn.
            rendered.serving_seat_id = Some(profile.seat_id.clone());
            Ok(())
        }
        _ => Err(RouteAuthError::UnsupportedRoute {
            harness_kind: harness_kind.to_string(),
            detail: format!("{harness_kind} has no seat recipe"),
        }),
    }
}

// ---------------------------------------------------------------------------
// provider_config route (Track D): "use my own cloud provider account" — the
// env map's keys are ALREADY the harness's real names (Python resolved them;
// see agent-auth.md's wire contract and state.rs's SOURCE_KIND_PROVIDER_CONFIG
// doc). Rust's job is only to pick which per-harness arm to run.
// ---------------------------------------------------------------------------

/// The registry's declared credential var for codex×azure_openai (D1's
/// registry.json `providerConfig[].envVars`), and the `env_key` codex's
/// `[model_providers.azure]` block references — mirrors the gateway recipe's
/// `env_key = "PROLIFERATE_GATEWAY_KEY"` pattern (D3 brief §5).
const AZURE_OPENAI_API_KEY_ENV: &str = "AZURE_OPENAI_API_KEY";
/// Placeholder env-var names for codex's Azure arm's base_url/deployment.
/// **ASSUMPTION, flagged in the PR body**: the registry today declares ONLY
/// `AZURE_OPENAI_API_KEY` for codex×azure_openai (the kind stays `pending`,
/// so no real selection can reach this arm yet); these two names are this
/// arm's placeholder expectation for when the registry is extended to wire a
/// real endpoint/deployment through, not a verified contract. Update these
/// constants (and the registry) together when Gate 4 for this cell is
/// scoped.
///
/// TODO(gate-4): the flip is NOT one line. Three things must land together, or
/// no producer will ever emit these keys: (1) the registry's
/// codex×azure_openai `providerConfig[].envVars` gains the endpoint/deployment
/// names and drops `pending`; (2) the python arm's translation table gains the
/// codex×azure_openai row (`_translate_provider_config_env` currently returns
/// `None` for that cell — structurally excluded); (3) these constants are
/// reconciled with whatever names (1) lands.
const AZURE_OPENAI_ENDPOINT_ENV: &str = "AZURE_OPENAI_ENDPOINT";
const AZURE_OPENAI_DEPLOYMENT_ENV: &str = "AZURE_OPENAI_DEPLOYMENT";

/// `provider_config_keys` accumulates every env var name THIS arm sets. It is
/// what lets [`sanitize_claude_ambient`] keep a rerouting flag this arm composed
/// while still stripping an identically-named `api_key` var.
fn render_provider_config(
    harness_kind: &str,
    profile: &ProviderConfigProfile,
    plan: &GatewayModelPlan,
    sequence: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
    provider_config_keys: &mut BTreeSet<String>,
) -> Result<(), RouteAuthError> {
    match (parse_harness(harness_kind)?, profile.config_kind.as_str()) {
        (AgentKind::Claude, _) | (AgentKind::OpenCode, _) => {
            // Fully generic: the map's keys are already the harness's real
            // env var names for EVERY config_kind claude/opencode support
            // (including the mode-switch flags CLAUDE_CODE_USE_BEDROCK /
            // CLAUDE_CODE_USE_FOUNDRY) — no per-kind branch needed, per the
            // wire-contract ruling (D3 brief §2/§3.3).
            for (key, value) in &profile.env {
                rendered.set_recorded(provider_config_keys, key, value);
            }
            Ok(())
        }
        (AgentKind::Codex, "aws_bedrock") => {
            let _ = plan;
            let codex_home = materialize::sequence_dir_path(
                runtime_home,
                materialize::CODEX_HOME_PREFIX,
                sequence,
            );
            rendered.set("CODEX_HOME", path_string(&codex_home));
            // No ambient-key removals here, unlike `render_codex_gateway`: that
            // recipe drops OPENAI_API_KEY/ANTHROPIC_API_KEY because its provider
            // is only reachable through the config file, whereas
            // `model_provider = "amazon-bedrock"` below pins the provider
            // outright — an ambient OpenAI/Anthropic key has nothing to shadow.
            // The asymmetry is intentional, not an omission.
            // AWS_REGION + AWS_BEARER_TOKEN_BEDROCK ride as plain env from the
            // already-resolved map (codex's built-in amazon-bedrock provider
            // reads its credential from env, same as claude/opencode) — NOT
            // interpolated into the TOML body.
            for (key, value) in &profile.env {
                rendered.set_recorded(provider_config_keys, key, value);
            }
            rendered.files.push(FileSpec {
                path_family: PathFamily::CodexHome,
                sequence,
                contents: Some(codex_config_toml(CodexConfigRecipe::Bedrock).into_bytes()),
            });
            Ok(())
        }
        (AgentKind::Codex, "azure_openai") => {
            // UNVERIFIED (see CodexConfigRecipe::Azure's doc): built so the
            // registry flip from `pending` is a one-line change later, but
            // NOT reachable today — the registry keeps codex×azure_openai
            // `pending` and the server's `supported_provider_config_kinds`
            // excludes it, so no real selection should ever construct this
            // profile. Render it anyway rather than erroring, so a future
            // flip needs no Rust change; the unit test in
            // provider_config_render_tests.rs exercises this arm directly
            // (not through the full pipeline, which cannot reach it yet).
            let api_key = profile.env.get(AZURE_OPENAI_API_KEY_ENV).ok_or_else(|| {
                RouteAuthError::SelectionIncomplete {
                    harness_kind: harness_kind.to_string(),
                    detail: format!(
                        "codex azure_openai requires '{AZURE_OPENAI_API_KEY_ENV}' in the resolved env map"
                    ),
                }
            })?;
            let base_url = profile.env.get(AZURE_OPENAI_ENDPOINT_ENV).ok_or_else(|| {
                RouteAuthError::SelectionIncomplete {
                    harness_kind: harness_kind.to_string(),
                    detail: format!(
                        "codex azure_openai requires '{AZURE_OPENAI_ENDPOINT_ENV}' in the resolved env map"
                    ),
                }
            })?;
            let deployment = profile
                .env
                .get(AZURE_OPENAI_DEPLOYMENT_ENV)
                .ok_or_else(|| RouteAuthError::SelectionIncomplete {
                    harness_kind: harness_kind.to_string(),
                    detail: format!(
                        "codex azure_openai requires '{AZURE_OPENAI_DEPLOYMENT_ENV}' in the resolved env map"
                    ),
                })?;
            let codex_home = materialize::sequence_dir_path(
                runtime_home,
                materialize::CODEX_HOME_PREFIX,
                sequence,
            );
            rendered.set("CODEX_HOME", path_string(&codex_home));
            rendered.set_recorded(provider_config_keys, AZURE_OPENAI_API_KEY_ENV, api_key);
            rendered.files.push(FileSpec {
                path_family: PathFamily::CodexHome,
                sequence,
                contents: Some(
                    codex_config_toml(CodexConfigRecipe::Azure {
                        base_url,
                        deployment,
                        env_key: AZURE_OPENAI_API_KEY_ENV,
                    })
                    .into_bytes(),
                ),
            });
            Ok(())
        }
        (AgentKind::Cursor, _) | (AgentKind::Grok, _) => Err(RouteAuthError::UnsupportedRoute {
            harness_kind: harness_kind.to_string(),
            detail: format!("{harness_kind} has no provider-config recipe"),
        }),
        (_, other) => Err(RouteAuthError::UnsupportedRoute {
            harness_kind: harness_kind.to_string(),
            detail: format!("unknown provider-config kind '{other}'"),
        }),
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn trim_trailing_slash(url: &str) -> &str {
    url.trim_end_matches('/')
}
