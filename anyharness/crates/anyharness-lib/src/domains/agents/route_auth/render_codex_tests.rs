//! Codex api_key route render coverage — split out of `render_tests.rs` to
//! keep each render-test file under the repo max-lines cap. A minimal resolver
//! and the small JSON state builders are duplicated here so the file stands
//! alone as a sibling test module (mirroring `render_tests.rs`'s own wiring).

use serde_json::{json, Value};

use super::plan::{GatewayModelPlan, GatewayModelResolve};
use super::resolve_launch_route_auth;
use super::test_support::TempHome;

/// The codex api_key route never consults the gateway model plan (only gateway
/// sources do), so a resolver that returns an empty plan satisfies the trait
/// bound.
struct HarnessPlanResolver;

impl GatewayModelResolve for HarnessPlanResolver {
    fn resolve_gateway_models(&self, _harness_kind: &str, _revision: i64) -> GatewayModelPlan {
        GatewayModelPlan::default()
    }
}

fn v2_state(revision: i64, harnesses: Vec<Value>) -> Value {
    json!({
        "version": 2,
        "revision": revision,
        "user_id": "user-1",
        "harnesses": harnesses,
    })
}

fn harness(kind: &str, sources: Vec<Value>) -> Value {
    json!({ "harness_kind": kind, "sources": sources })
}

fn api_key_source(env_var_name: &str, value: &str) -> Value {
    json!({ "kind": "api_key", "env_var_name": env_var_name, "value": value })
}

#[test]
fn codex_api_key_sets_var_and_writes_codex_local_auth() {
    let home = TempHome::new("codex-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness("codex", vec![api_key_source("OPENAI_API_KEY", "sk-openai")])],
    ));

    let rendered = resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");
    assert_eq!(rendered.set.get("OPENAI_API_KEY").unwrap(), "sk-openai");
    // The api_key route does NOT repoint CODEX_HOME (it stays the session-layer
    // codex-local home) and removes nothing.
    assert!(!rendered.set.contains_key("CODEX_HOME"));
    assert!(rendered.remove.is_empty());
    // But it MUST also write codex-local/auth.json so a route-authed resume
    // (session/load) can authenticate — the bare OPENAI_API_KEY env is ignored
    // on that path. This is the credential half of migrated-codex-session
    // portability.
    assert_eq!(rendered.files.len(), 1);
    let auth_path = home
        .path()
        .join("agent-auth")
        .join("codex-local")
        .join("auth.json");
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&auth_path).expect("read codex auth.json"))
            .expect("codex auth.json is valid json");
    assert_eq!(written["OPENAI_API_KEY"], "sk-openai");
}
