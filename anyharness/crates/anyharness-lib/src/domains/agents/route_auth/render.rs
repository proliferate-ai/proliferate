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
use super::profile::{
    AgentRuntimeAuthProfile, GatewayProfile, HarnessSources, ProviderConfigProfile, ResolvedSource,
};
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
///
/// `harness_kind` is needed even for [`AgentRuntimeAuthProfile::Native`]: native
/// is not always an empty delta. Codex reads its model and provider settings from
/// `CODEX_HOME/config.toml`, so a native codex launch needs a rendered config
/// too — see [`render_native`]. This is what lets the native recipe live in the
/// same table as the routed ones instead of in a second, divergent code path.
pub fn render_profile(
    profile: &AgentRuntimeAuthProfile,
    harness_kind: &str,
    plan: &GatewayModelPlan,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    match profile {
        AgentRuntimeAuthProfile::Native => render_native(harness_kind, plan, runtime_home),
        AgentRuntimeAuthProfile::Sources(sources) => render_sources(sources, plan, runtime_home),
    }
}

/// The NATIVE recipe table — "the user's own login owns auth", per harness.
///
/// For four of five harnesses this is genuinely an empty delta: the CLI finds its
/// own credentials and its own config, and injecting anything would be a lie
/// about what the user chose.
///
/// Codex is the exception, and folding it in here is the point of this function.
/// Codex takes its model and provider configuration from
/// `CODEX_HOME/config.toml` rather than from env, so *something* has to render
/// that file. Before this, a second isolated home (`agent-auth/codex-local/`) was
/// written on EVERY codex launch — including gateway-routed ones, where
/// route-auth's own `CODEX_HOME` then shadowed it — from a Rust constant pinning
/// `model = "gpt-5.5"`. That violated the catalog-owns-model-names law and left
/// a copy of the user's `auth.json` on disk for launches that never read it.
///
/// Now the native codex home is one arm of this table, sourced from the catalog
/// like every other model value, and it is rendered only when the launch is
/// actually native.
fn render_native(
    harness_kind: &str,
    plan: &GatewayModelPlan,
    runtime_home: &Path,
) -> Result<RenderedRouteAuth, RouteAuthError> {
    let mut rendered = RenderedRouteAuth::default();
    match parse_harness(harness_kind)? {
        AgentKind::Codex => render_codex_native(plan, runtime_home, &mut rendered)?,
        // claude/opencode/cursor/grok read their own credentials and their own
        // config on a native launch; there is nothing honest to inject.
        AgentKind::Claude | AgentKind::OpenCode | AgentKind::Cursor | AgentKind::Grok => {}
    }
    Ok(rendered)
}

/// Compose a harness's enabled sources into one additive launch delta. Each
/// `api_key` source rides its free-form env var; each `gateway` source runs the
/// per-harness recipe (consuming the catalog-resolved [`GatewayModelPlan`] for
/// model values, spec §3). The server validated legality, so ordering/count are
/// trusted here.
/// Sanitize claude's ambient provider env on EVERY non-native route, after the
/// sources have composed.
///
/// agent-auth.md requires sanitization on every non-native route, and it was only
/// wired into the gateway recipe. The gap this closes is REVERSE contamination:
/// an `api_key` selection set `ANTHROPIC_API_KEY` and stopped there, so on a
/// Bedrock-configured host the ambient `CLAUDE_CODE_USE_BEDROCK=1` survived and
/// the CLI routed the user's BYOK launch to Bedrock — billing an account they did
/// not select, with the key they did select sitting unused in the env.
///
/// Applied here rather than inside each recipe because it must observe the FULLY
/// composed delta: `sanitize_claude_ambient` keeps whatever this route actually
/// set and removes the rest, so running it per-source would let an earlier
/// source's var be removed on behalf of a later one.
fn sanitize_claude_if_routed(harness_kind: &str, rendered: &mut RenderedRouteAuth) {
    if harness_kind == AgentKind::Claude.as_str() {
        sanitize_claude_ambient(rendered);
    }
}

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
            }
            ResolvedSource::Gateway(profile) => render_gateway(
                &sources.harness_kind,
                profile,
                plan,
                sources.revision,
                runtime_home,
                &mut rendered,
            )?,
            ResolvedSource::ProviderConfig(profile) => render_provider_config(
                &sources.harness_kind,
                profile,
                plan,
                sources.revision,
                runtime_home,
                &mut rendered,
            )?,
        }
    }
    // Every non-native route, not just the gateway one. See the fn's doc for the
    // reverse-contamination case this closes. Must run AFTER provider_config
    // composes too, so a claude provider_config source's mode-switch flag
    // (e.g. CLAUDE_CODE_USE_BEDROCK) is what the sanitizer sees as "explicitly
    // set" and keeps, rather than stripping it as stale ambient state.
    sanitize_claude_if_routed(&sources.harness_kind, &mut rendered);
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
    // Sanitization is applied once for the whole composed delta by
    // `render_sources` (`sanitize_claude_if_routed`), not per-recipe — see that
    // fn for why the composed view is required.
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
///
/// Track D changes what "set" can mean for the rerouting flags themselves: a
/// `provider_config` × `aws_bedrock`/`azure_openai` source legitimately SETS
/// `CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_FOUNDRY` (that flag IS the
/// route), so these must also key off "did this render set it", exactly like
/// the Anthropic selector loop below — never an unconditional remove, or a
/// provider_config launch would sanitize away the very flag it just composed.
fn sanitize_claude_ambient(rendered: &mut RenderedRouteAuth) {
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        // Azure AI Foundry, the third provider-rerouting flag. Included now
        // rather than with Track D's Foundry support, because the flag reroutes
        // an ambient host TODAY whether or not we can yet configure Foundry
        // ourselves — leaving it out would be a hole with no upside.
        "CLAUDE_CODE_USE_FOUNDRY",
        "AWS_BEARER_TOKEN_BEDROCK",
    ] {
        if !rendered.set.contains_key(key) {
            rendered.remove(key);
        }
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
        contents: Some(
            codex_config_toml(CodexConfigRecipe::Gateway {
                base_url: &profile.base_url,
                default_model,
            })
            .into_bytes(),
        ),
    });
    Ok(())
}

/// The NATIVE codex recipe: an isolated `CODEX_HOME` holding TWO files — a
/// `config.toml` pinning the catalog's native default model, and the user's own
/// `auth.json`.
///
/// Why isolate at all when the credential is the user's own? Because codex reads
/// `~/.codex/config.toml`, and the runtime must not silently inherit whatever
/// model, provider or feature flags a developer left there — a session launched
/// from the product would then run a different configuration than the product
/// believes. Isolation also keeps the native and routed launch paths symmetric:
/// one home per route, rendered from the catalog, never edited in place.
///
/// **And why the credential must be delivered here.** Relocating `CODEX_HOME`
/// relocates where codex looks for its login: it resolves credentials at
/// `$CODEX_HOME/auth.json`, NOT at `~/.codex/auth.json`
/// ([`anyharness_credential_discovery::codex`]). So an isolated home that carries
/// only `config.toml` launches a natively-logged-in user UNAUTHENTICATED, and
/// nothing later fixes it: the login terminal runs `codex login` with only `PATH`
/// adjusted, so it writes `~/.codex` — never this home. The credential copy is
/// therefore not a leftover of the old implementation, it is what makes an
/// isolated native home usable at all.
///
/// Two files, one recipe: [`PathFamily::CodexNativeHome`] carries the rendered
/// config bytes; [`PathFamily::CodexNativeAuth`] carries no bytes because the
/// credential is read from the user's real codex home at APPLY time (render stays
/// pure — see [`materialize::apply_file_spec`], which also handles the
/// no-credential case by removing a stale copy).
fn render_codex_native(
    plan: &GatewayModelPlan,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    // No catalog default for a native codex launch → render nothing and let the
    // CLI use its own config. This is the honest degradation: a missing catalog
    // value must not become a hardcoded model id (the exact violation this
    // replaces), and unlike the gateway route a native launch CAN proceed
    // without our config file.
    //
    // Rendering nothing also leaves `CODEX_HOME` ambient, which is what keeps
    // this branch safe: the CLI reads its own `~/.codex` — config AND credential
    // together — so a missing catalog value degrades to "unmanaged" rather than
    // to "authenticated against nothing".
    let Some(default_model) = plan.native_default_model.as_deref() else {
        tracing::debug!(
            "codex native launch has no catalog default model; leaving the CLI's own config"
        );
        return Ok(());
    };
    let codex_home = materialize::codex_native_home_path(runtime_home);
    rendered.set("CODEX_HOME", path_string(&codex_home));
    rendered.files.push(FileSpec {
        path_family: PathFamily::CodexNativeHome,
        revision: 0,
        contents: Some(codex_config_toml(CodexConfigRecipe::Native { default_model }).into_bytes()),
    });
    // The credential that makes the relocated home usable. Its bytes are the
    // user's own codex login, resolved at apply time rather than here so this
    // function stays pure (contract §4 two-phase render).
    rendered.files.push(FileSpec {
        path_family: PathFamily::CodexNativeAuth,
        revision: 0,
        contents: None,
    });
    Ok(())
}

/// Which codex configuration a launch needs. One enum rather than one function
/// per route so every codex `config.toml` in the system is emitted by
/// [`codex_config_toml`] below — the property that keeps the variants
/// comparable and stops a new route from inventing its own TOML.
///
/// Track D (typed provider configs) adds two variants:
/// - `Bedrock { default_model }` → `model_provider = "amazon-bedrock"`,
///   codex's BUILT-IN upstream provider, so NO `[model_providers.*]` block at
///   all — the one variant that adds a provider without adding a table
///   (confirmed against catalog_probe.rs's corrected comment: the probe's own
///   custom `[model_providers.bedrock]` table is a PROBE-specific choice for
///   /v1/responses enumeration, not a statement about codex's real needs).
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
    /// The user's own login. Pins only the model — codex owns the credential.
    Native { default_model: &'a str },
    /// The managed gateway: a custom OpenAI-compatible provider whose key comes
    /// from `PROLIFERATE_GATEWAY_KEY` in the launch env.
    Gateway {
        base_url: &'a str,
        default_model: &'a str,
    },
    /// Track D: the user's own AWS Bedrock account, via codex's built-in
    /// `amazon-bedrock` provider. `default_model` is catalog-resolved from
    /// `session.defaults["bedrock"]` ([`GatewayModelPlan::bedrock_default_model`]),
    /// never a Rust constant.
    Bedrock { default_model: &'a str },
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
/// Every `model` value is catalog-resolved (`session.defaults[<context>]`),
/// never a Rust constant — that law is why the native arm exists at all.
fn codex_config_toml(recipe: CodexConfigRecipe<'_>) -> String {
    match recipe {
        CodexConfigRecipe::Native { default_model } => {
            format!("model = \"{default_model}\"\n")
        }
        CodexConfigRecipe::Gateway {
            base_url,
            default_model,
        } => {
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
        CodexConfigRecipe::Bedrock { default_model } => {
            // codex's BUILT-IN amazon-bedrock upstream: no [model_providers.*]
            // table at all (D3 brief §9, confirmed against catalog_probe.rs's
            // corrected comment). Credential + region ride as plain env from
            // profile.env, set by the caller — never interpolated here.
            format!(
                "model_provider = \"amazon-bedrock\"\n\
                 model = \"{default_model}\"\n"
            )
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
    // Isolate XDG_CONFIG_HOME so opencode reads OUR injected provider config
    // (revision-keyed, deterministic) rather than the user's global
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
const AZURE_OPENAI_ENDPOINT_ENV: &str = "AZURE_OPENAI_ENDPOINT";
const AZURE_OPENAI_DEPLOYMENT_ENV: &str = "AZURE_OPENAI_DEPLOYMENT";

fn render_provider_config(
    harness_kind: &str,
    profile: &ProviderConfigProfile,
    plan: &GatewayModelPlan,
    revision: i64,
    runtime_home: &Path,
    rendered: &mut RenderedRouteAuth,
) -> Result<(), RouteAuthError> {
    match (parse_harness(harness_kind)?, profile.config_kind.as_str()) {
        (AgentKind::Claude, _) | (AgentKind::OpenCode, _) => {
            // Fully generic: the map's keys are already the harness's real
            // env var names for EVERY config_kind claude/opencode support
            // (including the mode-switch flags CLAUDE_CODE_USE_BEDROCK /
            // CLAUDE_CODE_USE_FOUNDRY) — no per-kind branch needed, per the
            // wire-contract ruling (D3 brief §2/§3.3).
            for (key, value) in &profile.env {
                rendered.set(key, value);
            }
            Ok(())
        }
        (AgentKind::Codex, "aws_bedrock") => {
            // codex requires a model id in config.toml even on Bedrock, and
            // the native/gateway defaults are wrong contexts for it (see
            // GatewayModelPlan::bedrock_default_model's doc) — error rather
            // than invent one.
            let default_model = plan.bedrock_default_model.as_deref().ok_or_else(|| {
                RouteAuthError::SelectionIncomplete {
                    harness_kind: harness_kind.to_string(),
                    detail: "codex aws_bedrock requires a default model from the catalog \
                             (defaults[\"bedrock\"])"
                        .to_string(),
                }
            })?;
            let codex_home = materialize::revision_dir_path(
                runtime_home,
                materialize::CODEX_HOME_PREFIX,
                revision,
            );
            rendered.set("CODEX_HOME", path_string(&codex_home));
            // AWS_REGION + AWS_BEARER_TOKEN_BEDROCK ride as plain env from the
            // already-resolved map (codex's built-in amazon-bedrock provider
            // reads its credential from env, same as claude/opencode) — NOT
            // interpolated into the TOML body.
            for (key, value) in &profile.env {
                rendered.set(key, value);
            }
            rendered.files.push(FileSpec {
                path_family: PathFamily::CodexHome,
                revision,
                contents: Some(
                    codex_config_toml(CodexConfigRecipe::Bedrock { default_model }).into_bytes(),
                ),
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
            let codex_home = materialize::revision_dir_path(
                runtime_home,
                materialize::CODEX_HOME_PREFIX,
                revision,
            );
            rendered.set("CODEX_HOME", path_string(&codex_home));
            rendered.set(AZURE_OPENAI_API_KEY_ENV, api_key);
            rendered.files.push(FileSpec {
                path_family: PathFamily::CodexHome,
                revision,
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
