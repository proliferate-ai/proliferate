//! The probe seam: scoping (pure), phase-A read-only-ness, materialization under
//! a substituted root, GC isolation, permissions, cleanup, and the conservative
//! orphan sweep.
//!
//! Design-doc test ids are named on each test so a reviewer can map them.

// Shared by the sibling assertion files through `use super::*`.
#[allow(unused_imports)]
use std::collections::BTreeSet;
#[allow(unused_imports)]
use std::path::{Path, PathBuf};

#[allow(unused_imports)]
use serde_json::json;

use super::*;
use crate::domains::agents::catalog::schema::AgentCatalogAuthSignal;
use crate::domains::agents::route_auth::plan::GatewayModelPlan;
use crate::domains::agents::route_auth::profile::{ApiKeyProfile, GatewayProfile, HarnessSources};
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
        ..Default::default()
    }
}

fn scoped_sources(material: &ProbeAuthMaterial) -> Option<&[ResolvedSource]> {
    match &material.scoped_profile {
        AgentRuntimeAuthProfile::Sources(sources) => Some(&sources.sources),
        AgentRuntimeAuthProfile::Native => None,
    }
}

mod attribution_tests;
mod materialization_tests;
mod phase_a_tests;
mod scoping_tests;
mod sweep_tests;

/// Recursive listing of (path, mtime_nanos, len) under a root, for before/after
/// comparison.
pub(super) fn tree_snapshot(root: &Path) -> Vec<(PathBuf, i128, u64)> {
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
