//! The probe seam: scoping (pure), phase-A read-only-ness, materialization under
//! a substituted root, GC isolation, permissions, cleanup, and the conservative
//! orphan sweep.
//!
//! Design-doc test ids are named on each test so a reviewer can map them.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::*;
use crate::domains::agents::catalog::schema::AgentCatalogAuthSignal;
use crate::domains::agents::route_auth::plan::GatewayModelPlan;
use crate::domains::agents::route_auth::profile::{ApiKeyProfile, GatewayProfile};
use crate::domains::agents::route_auth::test_support::TempHome;

const GATEWAY_BASE_URL: &str = "https://llm.proliferate.ai";
const VK: &str = "sk-virtual-1234";

// ---------------------------------------------------------------------------
// Catalog context fixtures, matching catalogs/agents/catalog.json shapes.
// ---------------------------------------------------------------------------

fn context(
    id: &str,
    slot: Option<&str>,
    signals: Option<AgentCatalogAuthSignal>,
) -> AgentCatalogAuthContext {
    AgentCatalogAuthContext {
        id: id.to_string(),
        auth_slot_id: slot.map(str::to_string),
        description: None,
        signals,
    }
}

fn env_signal(vars: &[&str]) -> AgentCatalogAuthSignal {
    AgentCatalogAuthSignal::AnyOf(
        vars.iter()
            .map(|var| AgentCatalogAuthSignal::Env(var.to_string()))
            .collect(),
    )
}

fn discovery_signal(kinds: &[&str]) -> AgentCatalogAuthSignal {
    AgentCatalogAuthSignal::AnyOf(
        kinds
            .iter()
            .map(|kind| AgentCatalogAuthSignal::Discovery(kind.to_string()))
            .collect(),
    )
}

fn gateway_signal() -> AgentCatalogAuthSignal {
    AgentCatalogAuthSignal::Route("gateway".to_string())
}

/// opencode's six contexts, verbatim from the shipped catalog.
fn opencode_contexts() -> Vec<AgentCatalogAuthContext> {
    vec![
        context(
            "anthropic-api",
            Some("anthropic"),
            Some(AgentCatalogAuthSignal::AnyOf(vec![
                AgentCatalogAuthSignal::Env("ANTHROPIC_API_KEY".into()),
                AgentCatalogAuthSignal::Env("ANTHROPIC_AUTH_TOKEN".into()),
                AgentCatalogAuthSignal::Discovery("opencode-auth-json/anthropic".into()),
            ])),
        ),
        context(
            "openai-api",
            Some("openai"),
            Some(AgentCatalogAuthSignal::AnyOf(vec![
                AgentCatalogAuthSignal::Env("OPENAI_API_KEY".into()),
                AgentCatalogAuthSignal::Discovery("opencode-auth-json/openai".into()),
            ])),
        ),
        context(
            "gemini-api",
            Some("gemini"),
            Some(env_signal(&["GEMINI_API_KEY", "GOOGLE_API_KEY"])),
        ),
        context(
            "opencode-zen",
            Some("opencode-zen"),
            Some(AgentCatalogAuthSignal::Discovery(
                "opencode-auth-json/opencode".into(),
            )),
        ),
        context("baseline", None, None),
        context("gateway", Some("gateway"), Some(gateway_signal())),
    ]
}

/// claude's four contexts, verbatim from the shipped catalog.
fn claude_contexts() -> Vec<AgentCatalogAuthContext> {
    vec![
        context(
            "bedrock",
            Some("anthropic"),
            Some(AgentCatalogAuthSignal::EnvFlag(
                "CLAUDE_CODE_USE_BEDROCK=1".into(),
            )),
        ),
        context(
            "anthropic-api",
            Some("anthropic"),
            Some(env_signal(&["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"])),
        ),
        context(
            "anthropic-oauth",
            Some("anthropic"),
            Some(discovery_signal(&["claude-oauth-creds", "claude-keychain"])),
        ),
        context("gateway", Some("gateway"), Some(gateway_signal())),
    ]
}

fn codex_contexts() -> Vec<AgentCatalogAuthContext> {
    vec![
        context("bedrock", Some("openai"), None),
        context(
            "openai-oauth",
            Some("openai"),
            Some(discovery_signal(&["codex-auth-json-oauth", "codex-keychain"])),
        ),
        context(
            "openai-api",
            Some("openai"),
            Some(AgentCatalogAuthSignal::AnyOf(vec![
                AgentCatalogAuthSignal::Env("OPENAI_API_KEY".into()),
                AgentCatalogAuthSignal::Env("CODEX_API_KEY".into()),
                AgentCatalogAuthSignal::Discovery("codex-auth-json-api-key".into()),
            ])),
        ),
        context("gateway", Some("gateway"), Some(gateway_signal())),
    ]
}

fn grok_contexts() -> Vec<AgentCatalogAuthContext> {
    vec![
        context(
            "xai-api",
            Some("xai"),
            Some(AgentCatalogAuthSignal::AnyOf(vec![
                AgentCatalogAuthSignal::Env("XAI_API_KEY".into()),
                AgentCatalogAuthSignal::Env("GROK_API_KEY".into()),
                AgentCatalogAuthSignal::Discovery("grok-auth-json-oauth".into()),
            ])),
        ),
        context("gateway", Some("gateway"), Some(gateway_signal())),
    ]
}

fn cursor_contexts() -> Vec<AgentCatalogAuthContext> {
    vec![context(
        "cursor-login",
        Some("cursor"),
        Some(AgentCatalogAuthSignal::AnyOf(vec![
            AgentCatalogAuthSignal::Env("CURSOR_API_KEY".into()),
            AgentCatalogAuthSignal::Discovery("cursor-keychain".into()),
        ])),
    )]
}

/// Every (harness, context) pair the shipped catalog declares: 4+4+1+2+6 = 17.
fn all_seventeen_contexts() -> Vec<(&'static str, Vec<AgentCatalogAuthContext>)> {
    vec![
        ("claude", claude_contexts()),
        ("codex", codex_contexts()),
        ("cursor", cursor_contexts()),
        ("grok", grok_contexts()),
        ("opencode", opencode_contexts()),
    ]
}

fn gateway_source(key: &str) -> serde_json::Value {
    json!({ "kind": "gateway", "base_url": GATEWAY_BASE_URL, "key": key })
}

fn api_key_source(env_var_name: &str, value: &str) -> serde_json::Value {
    json!({ "kind": "api_key", "env_var_name": env_var_name, "value": value })
}

fn state(revision: i64, harnesses: serde_json::Value) -> serde_json::Value {
    json!({ "version": 2, "revision": revision, "harnesses": harnesses })
}

fn material_for(
    home: &TempHome,
    harness: &str,
    context_id: &str,
    contexts: &[AgentCatalogAuthContext],
) -> Result<ProbeAuthMaterial, RouteAuthError> {
    // Pass an explicit origin so the process-global env var never participates.
    probe_auth_material_for_server(home.path(), harness, context_id, contexts, None)
}

fn plan_with(models: &[&str]) -> GatewayModelPlan {
    GatewayModelPlan {
        default_model: Some("gpt-5.2".to_string()),
        native_default_model: Some("gpt-5.5".to_string()),
        small_fast_model: Some("claude-haiku-4-5-20251001".to_string()),
        models: models.iter().map(|model| model.to_string()).collect(),
    }
}

fn scoped_sources(material: &ProbeAuthMaterial) -> Option<&[ResolvedSource]> {
    match &material.scoped_profile {
        AgentRuntimeAuthProfile::Sources(sources) => Some(&sources.sources),
        AgentRuntimeAuthProfile::Native => None,
    }
}

// ---------------------------------------------------------------------------
// T-01..T-04: scoping (pure)
// ---------------------------------------------------------------------------

/// T-01 — opencode carries a gateway PLUS two api_key rows simultaneously, which
/// is legal. Each context must see only its own material.
///
/// This guards the bug that would otherwise make all six opencode contexts share
/// one identical union fingerprint, so rotating any single key would stale all six
/// entries and re-probe the harness six times.
#[test]
fn opencode_contexts_scope_to_their_own_source_only() {
    let home = TempHome::new("scope-opencode");
    home.write_state_json(&state(
        6,
        json!([{
            "harness_kind": "opencode",
            "sources": [
                gateway_source(VK),
                api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                api_key_source("OPENAI_API_KEY", "sk-oai"),
            ],
        }]),
    ));
    let contexts = opencode_contexts();

    let gateway = material_for(&home, "opencode", "gateway", &contexts).expect("gateway");
    assert_eq!(
        scoped_sources(&gateway).expect("sources").len(),
        1,
        "the gateway context must not see the api_key rows"
    );
    assert!(matches!(
        scoped_sources(&gateway).unwrap()[0],
        ResolvedSource::Gateway(_)
    ));

    let anthropic = material_for(&home, "opencode", "anthropic-api", &contexts).expect("anthropic");
    assert_eq!(
        scoped_sources(&anthropic).unwrap(),
        &[ResolvedSource::ApiKey(ApiKeyProfile {
            env_var_name: "ANTHROPIC_API_KEY".into(),
            value: "sk-ant".into(),
        })]
    );

    let openai = material_for(&home, "opencode", "openai-api", &contexts).expect("openai");
    assert_eq!(
        scoped_sources(&openai).unwrap(),
        &[ResolvedSource::ApiKey(ApiKeyProfile {
            env_var_name: "OPENAI_API_KEY".into(),
            value: "sk-oai".into(),
        })]
    );

    // gemini-api is a PURE env context (the shipped catalog gives it
    // GEMINI_API_KEY / GOOGLE_API_KEY and no discovery signal), and the document
    // carries no source for either: a selection this machine cannot honor.
    assert!(matches!(
        material_for(&home, "opencode", "gemini-api", &contexts),
        Err(RouteAuthError::SelectionMissing { .. })
    ));

    // But a MIXED env+discovery context with no enrolled source is the ordinary
    // logged-in case, not a failure: a launch there renders nothing and reads the
    // user's own credential, so the probe must do the same. Failing closed here
    // would turn every login-backed context on every enrolled machine into a
    // permanent failed attempt. (openai-api declares both an env signal and
    // `opencode-auth-json/openai`.)
    let home_login_only = TempHome::new("scope-login-only");
    home_login_only.write_state_json(&state(
        6,
        json!([{ "harness_kind": "opencode", "sources": [gateway_source(VK)] }]),
    ));
    let login_backed =
        material_for(&home_login_only, "opencode", "openai-api", &contexts).expect("login-backed");
    assert!(
        login_backed.is_native(),
        "a mixed env+discovery context with nothing enrolled reads the user's own login"
    );
    // The pure-env sibling on the SAME document still fails closed — proving the
    // discovery signal is what made the difference.
    assert!(matches!(
        material_for(&home_login_only, "opencode", "gemini-api", &contexts),
        Err(RouteAuthError::SelectionMissing { .. })
    ));

    // Discovery-only and baseline read the user's own login: inject nothing.
    for native_context in ["opencode-zen", "baseline"] {
        let scoped = material_for(&home, "opencode", native_context, &contexts).expect("native");
        assert!(
            scoped.is_native(),
            "{native_context} must resolve to the user's own login"
        );
    }
}

/// T-02 — claude's `bedrock` (an envFlag signal) and `anthropic-oauth` (a
/// discovery signal) both resolve Native: a launch renders no credential for
/// either, so neither may the probe.
#[test]
fn claude_env_flag_and_discovery_contexts_are_native() {
    let home = TempHome::new("scope-claude");
    home.write_state_json(&state(
        3,
        json!([{ "harness_kind": "claude", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = claude_contexts();

    for native_context in ["bedrock", "anthropic-oauth"] {
        let scoped = material_for(&home, "claude", native_context, &contexts).expect("native");
        assert!(scoped.is_native(), "{native_context} must be native");
        assert!(
            scoped.env_value_digests.is_empty(),
            "{native_context} must carry no credential digests"
        );
        assert!(scoped.gateway_base_url.is_none());
    }
    // The gateway context on the same document DOES resolve a route.
    let gateway = material_for(&home, "claude", "gateway", &contexts).expect("gateway");
    assert!(!gateway.is_native());
    assert_eq!(gateway.gateway_base_url.as_deref(), Some(GATEWAY_BASE_URL));
}

/// T-03 — cursor declares exactly one context, `cursor-login`, and it is Native.
/// A cursor GATEWAY context is unrepresentable: it does not exist in the catalog,
/// so the seam can never be asked for one. Forcing the render anyway is the only
/// way to see `UnsupportedRoute`, which is asserted here so the boundary is
/// pinned.
#[test]
fn cursor_has_only_a_native_login_context_and_no_gateway_route() {
    let home = TempHome::new("scope-cursor");
    home.write_state_json(&state(
        2,
        json!([{ "harness_kind": "cursor", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = cursor_contexts();
    assert_eq!(contexts.len(), 1, "the catalog gives cursor exactly one context");

    let login = material_for(&home, "cursor", "cursor-login", &contexts).expect("login");
    assert!(login.is_native());

    // Asking for a context id cursor does not declare falls back to Native (there
    // are no signals to read), NOT to a gateway materialization.
    let unknown = material_for(&home, "cursor", "gateway", &contexts).expect("unknown context");
    assert!(unknown.is_native());

    // And if a gateway profile were somehow forced through the renderer, the
    // renderer itself refuses.
    let forced = render_profile(
        &AgentRuntimeAuthProfile::Sources(HarnessSources {
            harness_kind: "cursor".to_string(),
            revision: 2,
            sources: vec![ResolvedSource::Gateway(GatewayProfile {
                base_url: GATEWAY_BASE_URL.to_string(),
                key: VK.to_string(),
            })],
        }),
        "cursor",
        &plan_with(&[]),
        home.path(),
    );
    assert!(matches!(forced, Err(RouteAuthError::UnsupportedRoute { .. })));
}

/// T-04 — `baseline` scrubs every registry-declared credential var for the
/// harness, and does so WITHOUT mutating this process's environment. The central
/// CLI mutates its own env for this; inside a long-lived server that would blind
/// every later credential classification.
#[test]
fn baseline_scrubs_registry_env_vars_without_touching_process_env() {
    let home = TempHome::new("scope-baseline");
    home.write_state_json(&state(1, json!([])));
    let contexts = opencode_contexts();

    let probe_var = "ANTHROPIC_API_KEY";
    let before = std::env::var_os(probe_var);

    let material = material_for(&home, "opencode", "baseline", &contexts).expect("baseline");
    let materialized =
        materialize_for_probe(home.path(), "opencode", &material, &plan_with(&["m-1"]))
            .expect("materialize");

    let removed: BTreeSet<&str> = materialized
        .env_remove
        .iter()
        .map(String::as_str)
        .collect();
    // Whatever the registry declares for opencode must all be removed. Assert the
    // relationship rather than a hardcoded list, so a registry addition cannot
    // silently escape the scrub.
    let declared: BTreeSet<String> = bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == "opencode")
        .expect("opencode in registry")
        .auth
        .slots
        .iter()
        .flat_map(|slot| slot.env_vars.iter())
        .map(|env_var| env_var.name().to_string())
        .collect();
    assert!(!declared.is_empty(), "opencode declares credential env vars");
    for name in &declared {
        assert!(
            removed.contains(name.as_str()),
            "baseline must scrub the registry-declared {name}"
        );
    }

    assert_eq!(
        std::env::var_os(probe_var),
        before,
        "the scrub must be per-child, never a process-env mutation"
    );
}

// ---------------------------------------------------------------------------
// T-30..T-31: phase A is read-only, and phase A/B agree
// ---------------------------------------------------------------------------

/// Recursive listing of (path, mtime_nanos, len) under a root, for before/after
/// comparison.
fn tree_snapshot(root: &Path) -> Vec<(PathBuf, i128, u64)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            let (mtime, len) = std::fs::metadata(&path)
                .map(|metadata| {
                    let mtime = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|duration| duration.as_nanos() as i128)
                        .unwrap_or_default();
                    (mtime, metadata.len())
                })
                .unwrap_or((0, 0));
            out.push((path.clone(), mtime, len));
            if is_dir {
                stack.push(path);
            }
        }
    }
    out.sort();
    out
}

/// T-30 — **the assertion the two-phase split exists for.** Evaluating the gate
/// for all 17 (harness, context) pairs must leave the runtime home byte-identical:
/// no `agent-auth-probe/`, no `codex-home-*`, no `opencode.json`, no `*.tmp-*`.
///
/// A single-function seam would have failed this: it would have written a 0700
/// scratch plus a virtual-key-bearing config on every one of the 17 evaluations,
/// including the 17 "fresh, do nothing" answers of a startup pass.
#[test]
fn a_gate_evaluation_over_every_context_writes_nothing() {
    let home = TempHome::new("phase-a-readonly");
    home.write_state_json(&state(
        11,
        json!([
            { "harness_kind": "claude", "sources": [gateway_source(VK)] },
            { "harness_kind": "codex", "sources": [gateway_source(VK)] },
            { "harness_kind": "grok", "sources": [gateway_source(VK)] },
            {
                "harness_kind": "opencode",
                "sources": [
                    gateway_source(VK),
                    api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                    api_key_source("OPENAI_API_KEY", "sk-oai"),
                ],
            },
        ]),
    ));

    let before = tree_snapshot(home.path());
    let mut evaluated = 0;
    for (harness, contexts) in all_seventeen_contexts() {
        for context in &contexts {
            // Errors are legitimate answers here (an unsatisfiable context); what
            // matters is that neither answer writes.
            let _ = material_for(&home, harness, &context.id, &contexts);
            evaluated += 1;
        }
    }
    assert_eq!(evaluated, 17, "the shipped catalog declares 17 contexts");

    let after = tree_snapshot(home.path());
    assert_eq!(
        before, after,
        "phase A must not create, modify or remove anything under the runtime home"
    );
    assert!(
        !home.path().join("agent-auth-probe").exists(),
        "no scratch root may exist after gate evaluations"
    );
}

/// T-31 — phase B uses the revision phase A carried, and it uses the profile phase
/// A captured: mutating `state.json` between the two phases must not change what
/// gets materialized. One state read, one revision, three consumers.
#[test]
fn phase_b_uses_the_revision_and_profile_phase_a_captured() {
    let home = TempHome::new("phase-agreement");
    home.write_state_json(&state(
        7,
        json!([{ "harness_kind": "codex", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = codex_contexts();

    let material = material_for(&home, "codex", "gateway", &contexts).expect("material");
    assert_eq!(material.state_revision, 7);

    // The document moves on — a different revision AND a different key — after the
    // gate decided.
    home.write_state_json(&state(
        99,
        json!([{ "harness_kind": "codex", "sources": [gateway_source("sk-rotated")] }]),
    ));

    let materialized = materialize_for_probe(home.path(), "codex", &material, &plan_with(&["m-1"]))
        .expect("materialize");

    assert!(
        materialized.scratch.root().join("agent-auth/codex-home-7").is_dir(),
        "the scratch dir must be keyed on the revision phase A read, not the current one"
    );
    assert!(
        !materialized.scratch.root().join("agent-auth/codex-home-99").exists(),
        "phase B must not re-read state.json"
    );
    assert_eq!(
        materialized.env_set.get("PROLIFERATE_GATEWAY_KEY").map(String::as_str),
        Some(VK),
        "phase B must materialize the credential the gate judged, not a newer one"
    );
}

// ---------------------------------------------------------------------------
// T-05..T-09, T-13..T-15: materialization under a substituted root
// ---------------------------------------------------------------------------

/// T-05 — the substituted-root property, per gateway-capable harness: every path
/// the render emits is under the scratch, the file set matches a launch's, and the
/// live `agent-auth/` gains nothing but the pre-seeded `state.json`.
#[test]
fn every_gateway_materialization_lands_entirely_under_the_scratch_root() {
    let cases: Vec<(&str, Vec<AgentCatalogAuthContext>, Vec<&str>)> = vec![
        ("claude", claude_contexts(), vec!["agent-auth/claude-config"]),
        (
            "codex",
            codex_contexts(),
            vec!["agent-auth/codex-home-5/config.toml"],
        ),
        (
            "opencode",
            opencode_contexts(),
            vec![
                "agent-auth/opencode-config-5/opencode.json",
                "agent-auth/opencode-config-5/xdg-config",
                "agent-auth/opencode-config-5/xdg-data",
            ],
        ),
        ("grok", grok_contexts(), vec!["agent-auth/grok-home-5"]),
    ];

    for (harness, contexts, expected_paths) in cases {
        let home = TempHome::new(&format!("substitute-{harness}"));
        home.write_state_json(&state(
            5,
            json!([{ "harness_kind": harness, "sources": [gateway_source(VK)] }]),
        ));

        let material = material_for(&home, harness, "gateway", &contexts).expect("material");
        let plan = plan_with(&["m-1", "m-2"]);
        let materialized =
            materialize_for_probe(home.path(), harness, &material, &plan).expect("materialize");
        let scratch_root = materialized.scratch.root().to_path_buf();

        for (key, value) in &materialized.env_set {
            if !value.starts_with('/') {
                // Not a path (a key, a URL, a model id).
                continue;
            }
            assert!(
                Path::new(value).starts_with(&scratch_root),
                "{harness}: {key} points outside the scratch root: {value}"
            );
        }
        for relative in &expected_paths {
            assert!(
                scratch_root.join(relative).exists(),
                "{harness}: expected {relative} under the scratch"
            );
        }

        // The live route-auth root gained nothing.
        let live_entries: Vec<String> = std::fs::read_dir(home.path().join("agent-auth"))
            .expect("read live agent-auth")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            live_entries,
            vec!["state.json".to_string()],
            "{harness}: a probe must write nothing into the live agent-auth root"
        );

        // Byte-identical to what a LAUNCH at the same revision and plan renders.
        let launch_rendered = render_profile(
            &material.scoped_profile,
            harness,
            &plan,
            Path::new("/launch-root"),
        )
        .expect("launch render");
        let probe_rendered =
            render_profile(&material.scoped_profile, harness, &plan, &scratch_root)
                .expect("probe render");
        let launch_bytes: Vec<Option<Vec<u8>>> = launch_rendered
            .files
            .iter()
            .map(|spec| spec.contents.clone())
            .collect();
        let probe_bytes: Vec<Option<Vec<u8>>> = probe_rendered
            .files
            .iter()
            .map(|spec| spec.contents.clone())
            .collect();
        assert_eq!(
            launch_bytes, probe_bytes,
            "{harness}: config bytes must not depend on the materialization root"
        );
    }
}

/// T-06 — **GC isolation, with the corrected assertion.**
///
/// Two halves. (1) A probe's own GC deletes nothing: the scratch is fresh, so
/// "greatest revision strictly below current" finds no candidate, and the three
/// live dirs are untouched. (2) A subsequent LAUNCH at revision 8 over live
/// `{5,6,7}` deletes **both 5 AND 6**, not just 5: `gc_old_revision_dirs` runs
/// BEFORE the revision-8 dir is created, so the revisions present are `[5,6,7]`,
/// `previous_revision` is 7, and everything strictly below 7 goes. The keep-window
/// is current-plus-previous relative to what is ON DISK, not to the incoming
/// revision.
#[test]
fn probe_gc_is_a_no_op_and_the_launch_gc_keeps_only_the_previous_on_disk_revision() {
    let home = TempHome::new("gc-isolation");
    home.write_state_json(&state(
        7,
        json!([{ "harness_kind": "codex", "sources": [gateway_source(VK)] }]),
    ));
    for revision in [5, 6, 7] {
        std::fs::create_dir_all(home.path().join(format!("agent-auth/codex-home-{revision}")))
            .expect("seed live revision dir");
    }
    let contexts = codex_contexts();

    let material = material_for(&home, "codex", "gateway", &contexts).expect("material");
    let materialized = materialize_for_probe(home.path(), "codex", &material, &plan_with(&["m"]))
        .expect("materialize");

    for revision in [5, 6, 7] {
        assert!(
            home.path()
                .join(format!("agent-auth/codex-home-{revision}"))
                .is_dir(),
            "the probe's GC must delete no live revision dir (codex-home-{revision})"
        );
    }
    let scratch_revision_dirs: Vec<String> =
        std::fs::read_dir(materialized.scratch.root().join("agent-auth"))
            .expect("read scratch agent-auth")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("codex-home-"))
            .collect();
    assert_eq!(
        scratch_revision_dirs,
        vec!["codex-home-7".to_string()],
        "the scratch holds exactly the probed revision"
    );

    // Now a launch at revision 8, which DOES garbage-collect.
    home.write_state_json(&state(
        8,
        json!([{ "harness_kind": "codex", "sources": [gateway_source(VK)] }]),
    ));
    let launch_material = material_for(&home, "codex", "gateway", &contexts).expect("launch material");
    let launch_rendered = render_profile(
        &launch_material.scoped_profile,
        "codex",
        &plan_with(&["m"]),
        home.path(),
    )
    .expect("launch render");
    for spec in &launch_rendered.files {
        materialize::apply_file_spec(home.path(), spec).expect("launch apply");
    }

    let mut live: Vec<String> = std::fs::read_dir(home.path().join("agent-auth"))
        .expect("read live")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("codex-home-"))
        .collect();
    live.sort();
    assert_eq!(
        live,
        vec!["codex-home-7".to_string(), "codex-home-8".to_string()],
        "the launch GC removes BOTH codex-home-5 and codex-home-6"
    );
    assert!(
        materialized.scratch.root().is_dir(),
        "the launch GC must never touch the probe scratch"
    );
}

/// T-07 — the claude hazard: `claude-config/` is deliberately NOT revision-keyed,
/// so every running claude session shares it. A probe must never write there.
#[test]
fn a_claude_probe_never_touches_the_shared_live_config_dir() {
    let home = TempHome::new("claude-shared-dir");
    home.write_state_json(&state(
        4,
        json!([{ "harness_kind": "claude", "sources": [gateway_source(VK)] }]),
    ));
    let live_config = home.path().join("agent-auth/claude-config");
    std::fs::create_dir_all(&live_config).expect("seed live claude-config");
    let sentinel = live_config.join("settings.json");
    std::fs::write(&sentinel, b"{\"live\":true}").expect("seed sentinel");
    let before = std::fs::metadata(&live_config)
        .and_then(|metadata| metadata.modified())
        .expect("live mtime");

    let contexts = claude_contexts();
    let material = material_for(&home, "claude", "gateway", &contexts).expect("material");
    let materialized = materialize_for_probe(home.path(), "claude", &material, &plan_with(&[]))
        .expect("materialize");

    let after = std::fs::metadata(&live_config)
        .and_then(|metadata| metadata.modified())
        .expect("live mtime after");
    assert_eq!(before, after, "the live claude-config mtime must not move");
    assert_eq!(
        std::fs::read(&sentinel).expect("sentinel"),
        b"{\"live\":true}",
        "an in-flight session's settings must be untouched"
    );
    assert!(
        materialized
            .scratch
            .root()
            .join("agent-auth/claude-config")
            .is_dir(),
        "the probe's own claude-config lives in the scratch"
    );
}

/// T-08 — permissions and no tmp residue. The scratch is 0700 BEFORE any content
/// lands, so nested dirs cannot be world-traversable regardless of umask; secret
/// files stay 0600 through the unchanged `write_private_file`.
#[cfg(unix)]
#[test]
fn scratch_is_0700_secret_files_are_0600_and_no_tmp_residue_remains() {
    use std::os::unix::fs::PermissionsExt;

    let home = TempHome::new("perms");
    home.write_state_json(&state(
        3,
        json!([{ "harness_kind": "opencode", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = opencode_contexts();
    let material = material_for(&home, "opencode", "gateway", &contexts).expect("material");
    let materialized =
        materialize_for_probe(home.path(), "opencode", &material, &plan_with(&["m-1"]))
            .expect("materialize");
    let root = materialized.scratch.root();

    let mode = std::fs::metadata(root).expect("scratch metadata").permissions().mode() & 0o777;
    assert_eq!(mode, 0o700, "scratch root must be 0700, got {mode:o}");

    let config = root.join("agent-auth/opencode-config-3/opencode.json");
    let config_mode = std::fs::metadata(&config)
        .expect("config metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(config_mode, 0o600, "opencode.json must be 0600");

    let residue: Vec<PathBuf> = tree_snapshot(root)
        .into_iter()
        .map(|(path, _, _)| path)
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(".tmp-"))
        })
        .collect();
    assert!(residue.is_empty(), "no tmp residue expected, found {residue:?}");
}

/// T-09 — the guard removes the root on every exit path: success, an `Err` return,
/// and an unwind. The unwind case is the one a `defer`-less design gets wrong.
#[test]
fn the_scratch_guard_removes_its_root_on_success_error_and_unwind() {
    let home = TempHome::new("guard");
    home.write_state_json(&state(
        2,
        json!([{ "harness_kind": "grok", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = grok_contexts();
    let material = material_for(&home, "grok", "gateway", &contexts).expect("material");

    // Success path.
    let root = {
        let materialized = materialize_for_probe(home.path(), "grok", &material, &plan_with(&[]))
            .expect("materialize");
        materialized.scratch.root().to_path_buf()
    };
    assert!(!root.exists(), "the root must be gone after a normal drop");

    // Err path: a scope that materializes then returns an error.
    let root = (|| -> Result<PathBuf, RouteAuthError> {
        let materialized = materialize_for_probe(home.path(), "grok", &material, &plan_with(&[]))?;
        let root = materialized.scratch.root().to_path_buf();
        Err(RouteAuthError::Materialize {
            detail: format!("synthetic failure holding {}", root.display()),
        })
    })()
    .expect_err("synthetic failure")
    .to_string();
    let root = PathBuf::from(
        root.rsplit_once("synthetic failure holding ")
            .map(|(_, path)| path)
            .expect("path in message"),
    );
    assert!(!root.exists(), "the root must be gone after an Err return");

    // Unwind path.
    let captured = std::sync::Arc::new(std::sync::Mutex::new(None));
    let sink = captured.clone();
    let home_path = home.path().to_path_buf();
    let unwind_material = probe_auth_material_for_server(
        home.path(),
        "grok",
        "gateway",
        &contexts,
        None,
    )
    .expect("material");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let materialized =
            materialize_for_probe(&home_path, "grok", &unwind_material, &plan_with(&[]))
                .expect("materialize");
        *sink.lock().expect("sink") = Some(materialized.scratch.root().to_path_buf());
        panic!("synthetic panic while holding the guard");
    }));
    assert!(result.is_err(), "the closure must have panicked");
    let root = captured.lock().expect("captured").clone().expect("root recorded");
    assert!(!root.exists(), "the root must be gone after an unwind");
}

/// T-13 — the origin guard: a `state.json` stamped for a DIFFERENT server yields
/// Native, so a desktop mid-server-switch cannot record the abandoned server's
/// gateway model list as this machine's truth.
#[test]
fn a_state_file_from_another_server_yields_no_gateway_material() {
    let home = TempHome::new("origin-guard");
    home.write_state_json(&json!({
        "version": 2,
        "revision": 9,
        "issuing_server_origin": "https://other.example",
        "harnesses": [{ "harness_kind": "claude", "sources": [gateway_source(VK)] }],
    }));
    let contexts = claude_contexts();

    let mismatched = probe_auth_material_for_server(
        home.path(),
        "claude",
        "gateway",
        &contexts,
        Some("https://here.example"),
    )
    .expect("material");
    assert!(
        mismatched.is_native(),
        "an abandoned server's state must not materialize"
    );
    assert!(mismatched.gateway_base_url.is_none());
    // The same input under the matching origin DOES resolve — proving the guard is
    // what made the difference, not a broken fixture.
    let matched = probe_auth_material_for_server(
        home.path(),
        "claude",
        "gateway",
        &contexts,
        Some("https://other.example"),
    )
    .expect("material");
    assert!(!matched.is_native());
}

/// T-14 — no plaintext leaves the material, and none reaches the fingerprint
/// inputs. The `Debug` impl is hand-written precisely so the privately-held scoped
/// profile cannot print a key.
#[test]
fn the_material_carries_no_plaintext_credential() {
    let secret = "sk-secret-do-not-log";
    let home = TempHome::new("no-plaintext");
    home.write_state_json(&state(
        1,
        json!([{
            "harness_kind": "opencode",
            "sources": [gateway_source(secret), api_key_source("ANTHROPIC_API_KEY", secret)],
        }]),
    ));
    let contexts = opencode_contexts();

    for context_id in ["gateway", "anthropic-api"] {
        let material = material_for(&home, "opencode", context_id, &contexts).expect("material");
        let debug = format!("{material:?}");
        assert!(
            !debug.contains(secret),
            "{context_id}: Debug output leaked the credential"
        );
        assert!(debug.contains("<redacted>"));
        for (name, digest) in &material.env_value_digests {
            assert!(!name.contains(secret));
            assert!(!digest.contains(secret));
            assert_eq!(digest.len(), 64, "digests are hex sha256");
        }
    }
}

/// T-15 — env-removal plumbing, end to end. Claude's sanitization is half of every
/// non-native recipe; a probe that dropped it would observe Bedrock's menu on a
/// Bedrock-exporting machine and record it as gateway truth.
///
/// Asserted for BOTH the gateway and the `api_key` context, because as of A5
/// `sanitize_claude_ambient` runs on every non-native claude route — an `api_key`
/// context now has a non-empty removal list too.
#[test]
fn claude_removals_reach_the_spawn_env_for_gateway_and_api_key_routes() {
    let home = TempHome::new("env-remove");
    home.write_state_json(&state(
        3,
        json!([{
            "harness_kind": "claude",
            "sources": [gateway_source(VK)],
        }]),
    ));
    let contexts = claude_contexts();
    let material = material_for(&home, "claude", "gateway", &contexts).expect("material");
    let materialized = materialize_for_probe(home.path(), "claude", &material, &plan_with(&[]))
        .expect("materialize");

    for expected in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "AWS_BEARER_TOKEN_BEDROCK",
        "ANTHROPIC_API_KEY",
    ] {
        assert!(
            materialized.env_remove.iter().any(|key| key == expected),
            "the gateway route must remove {expected}"
        );
    }

    // The removals actually win at spawn: the driver applies route_auth_remove
    // last, so an ambient/composed value cannot survive. Routed through the SAME
    // ProbeOptions the engine builds, so a probe_agent that forgot to pass the
    // removals through would fail here.
    let options = crate::live::sessions::probe::ProbeOptions {
        agent_kind: crate::domains::agents::model::AgentKind::Claude,
        auth_context: "gateway".to_string(),
        auth_env: materialized.env_set.clone(),
        auth_env_remove: materialized.env_remove.clone(),
        runtime_home: home.path().to_path_buf(),
        workspace_root: Some(materialized.scratch.workspace_root()),
        model_switch_timeout: std::time::Duration::from_secs(1),
        max_models: None,
        switch_models: false,
        send_test_prompt: false,
    };
    let ambient: std::collections::BTreeMap<String, String> = [
        ("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string()),
        ("ANTHROPIC_API_KEY".to_string(), "sk-ambient".to_string()),
    ]
    .into_iter()
    .collect();
    let merged = crate::live::sessions::probe::spawn_env_for_options(&options, &ambient);
    assert!(
        !merged.contains_key("CLAUDE_CODE_USE_BEDROCK"),
        "an ambient Bedrock flag must not reach the probed child"
    );
    assert!(
        !merged.contains_key("ANTHROPIC_API_KEY"),
        "an ambient raw key must not shadow the gateway token"
    );
    assert_eq!(
        merged.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
        Some(VK),
        "the route's own credential survives"
    );

    // The api_key context on the same harness ALSO carries removals (A5 widened
    // this), so its probe is the sanitized one.
    home.write_state_json(&state(
        4,
        json!([{
            "harness_kind": "claude",
            "sources": [api_key_source("ANTHROPIC_API_KEY", "sk-byok")],
        }]),
    ));
    let api_material = material_for(&home, "claude", "anthropic-api", &contexts).expect("material");
    let api_materialized =
        materialize_for_probe(home.path(), "claude", &api_material, &plan_with(&[]))
            .expect("materialize");
    assert!(
        api_materialized
            .env_remove
            .iter()
            .any(|key| key == "CLAUDE_CODE_USE_BEDROCK"),
        "an api_key claude probe must strip the reroute flags too"
    );
    assert_eq!(
        api_materialized.env_set.get("ANTHROPIC_API_KEY").map(String::as_str),
        Some("sk-byok"),
        "and must keep the key it was asked to observe"
    );
}

// ---------------------------------------------------------------------------
// T-12: the conservative orphan sweep
// ---------------------------------------------------------------------------

/// T-12 — the sweep removes ONLY roots that are both abandoned AND old.
///
/// Five roots: (a) our own pid, (b) a live foreign pid, (c) a dead pid with a fresh
/// timestamp, (d) a dead pid older than the age bound, (e) an unparseable name with
/// an old mtime. Only (d) and (e) may go. An unconditional sweep would remove all
/// five, which is the data-loss case: it would delete another runtime's in-flight
/// probe config mid-spawn.
#[test]
fn the_sweep_removes_only_abandoned_and_old_scratch_roots() {
    let home = TempHome::new("sweep");
    let probe_dir = home.path().join("agent-auth-probe");
    std::fs::create_dir_all(&probe_dir).expect("create probe dir");
    std::fs::create_dir_all(home.path().join("agent-auth")).expect("create live dir");
    std::fs::write(home.path().join("agent-auth/state.json"), b"{}").expect("seed state");

    let now_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let max_age = std::time::Duration::from_secs(720);
    let old_nanos = now_nanos - (max_age.as_nanos() * 2);

    // A real live foreign process, so (b) is not a fiction.
    let mut live_child = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .expect("spawn a live foreign process");
    let live_pid = live_child.id();
    // A pid that is definitely dead: spawn and reap.
    let mut dead_child = std::process::Command::new("true")
        .spawn()
        .expect("spawn a short-lived process");
    let dead_pid = dead_child.id();
    dead_child.wait().expect("reap");

    let own = probe_dir.join(format!("claude-gateway-{}-{old_nanos}", std::process::id()));
    let live = probe_dir.join(format!("codex-gateway-{live_pid}-{old_nanos}"));
    let dead_fresh = probe_dir.join(format!("grok-gateway-{dead_pid}-{now_nanos}"));
    let dead_old = probe_dir.join(format!("opencode-gateway-{dead_pid}-{old_nanos}"));
    let unparseable = probe_dir.join("not-a-scratch-name");
    for root in [&own, &live, &dead_fresh, &dead_old, &unparseable] {
        std::fs::create_dir_all(root).expect("create scratch root");
    }
    // Age the unparseable dir past the bound via its mtime. Creating it and
    // asserting on `elapsed()` requires a real clock gap, so instead set the mtime
    // explicitly where the platform allows it; when it does not, skip that leg.
    let unparseable_aged = set_dir_mtime_back(&unparseable, max_age * 2);

    let removed = sweep_probe_scratch(home.path(), max_age);

    assert!(own.is_dir(), "our own pid's scratch must survive");
    assert!(live.is_dir(), "a live foreign pid's scratch must survive");
    assert!(
        dead_fresh.is_dir(),
        "a dead pid's FRESH scratch must survive the age gate"
    );
    assert!(!dead_old.exists(), "a dead pid's old scratch must be removed");
    assert!(removed.contains(&dead_old));
    if unparseable_aged {
        assert!(
            !unparseable.exists(),
            "an unparseable old-mtime dir must be removed"
        );
    } else {
        assert!(
            unparseable.is_dir(),
            "without a settable mtime the unparseable dir is too young to remove"
        );
    }
    assert!(
        home.path().join("agent-auth/state.json").exists(),
        "the sweep must never touch the live agent-auth root"
    );

    let _ = live_child.kill();
    let _ = live_child.wait();
}

/// Best-effort: move a directory's mtime back so the age gate can be exercised
/// without sleeping. Returns false when the platform refuses, so the caller can
/// assert the other direction instead of silently passing.
fn set_dir_mtime_back(path: &Path, by: std::time::Duration) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    let Some(target) = modified.checked_sub(by) else {
        return false;
    };
    let seconds = match target.duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as i64,
        Err(_) => return false,
    };
    let output = std::process::Command::new("touch")
        .arg("-t")
        .arg(format_touch_stamp(seconds))
        .arg(path)
        .output();
    matches!(output, Ok(output) if output.status.success())
}

/// `touch -t` wants `[[CC]YY]MMDDhhmm[.ss]`.
fn format_touch_stamp(unix_seconds: i64) -> String {
    let time = chrono::DateTime::from_timestamp(unix_seconds, 0).unwrap_or_default();
    time.format("%Y%m%d%H%M.%S").to_string()
}
