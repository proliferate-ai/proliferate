//! Server-switch origin guard (self-hosting-v1 §3.5, D1): a state file
//! stamped for a different server than the caller's current origin must
//! never inject that OTHER server's gateway token. Exercised through
//! `resolve_launch_route_auth_for_server` (not the env-var-reading public
//! wrapper) so these run safely alongside every other test in this crate
//! without mutating process-global env state. Split into its own file from
//! `render_tests.rs` to stay under the repo's max-source-file-length check.

use serde_json::json;

use super::plan::{GatewayModelPlan, GatewayModelResolve};
use super::test_support::TempHome;

const GATEWAY_BASE_URL: &str = "https://llm.proliferate.ai";
const VK: &str = "sk-virtual-1234";

struct HarnessPlanResolver;

impl GatewayModelResolve for HarnessPlanResolver {
    fn resolve_gateway_models(&self, harness_kind: &str, _revision: i64) -> GatewayModelPlan {
        match harness_kind {
            "claude" => GatewayModelPlan {
                small_fast_model: Some("claude-haiku-4-5-20251001".to_string()),
                ..Default::default()
            },
            _ => GatewayModelPlan::default(),
        }
    }
}

fn stamped_gateway_state(kind: &str, issuing_server_origin: Option<&str>) -> serde_json::Value {
    let mut state = json!({
        "version": 2,
        "revision": 42,
        "user_id": "user-1",
        "harnesses": [
            {
                "harness_kind": kind,
                "sources": [
                    { "kind": "gateway", "base_url": GATEWAY_BASE_URL, "key": VK },
                ],
            },
        ],
    });
    let object = state.as_object_mut().expect("state is an object");
    match issuing_server_origin {
        Some(origin) => {
            object.insert("issuing_server_origin".to_string(), json!(origin));
        }
        None => {
            object.remove("issuing_server_origin");
        }
    }
    state
}

#[test]
fn matching_origin_still_injects_the_gateway_route() {
    let home = TempHome::new("origin-match");
    home.write_state_json(&stamped_gateway_state(
        "claude",
        Some("https://proliferate.corp.example"),
    ));

    let rendered = super::resolve_launch_route_auth_for_server(
        home.path(),
        "claude",
        &HarnessPlanResolver,
        Some("https://proliferate.corp.example"),
    )
    .expect("render");

    assert_eq!(
        rendered.set.get("ANTHROPIC_AUTH_TOKEN").unwrap(),
        VK,
        "same-origin state must still inject the gateway credential"
    );
}

#[test]
fn mismatched_origin_is_treated_as_native_no_injection() {
    let home = TempHome::new("origin-mismatch");
    home.write_state_json(&stamped_gateway_state(
        "claude",
        Some("https://old-server.example"),
    ));

    let rendered = super::resolve_launch_route_auth_for_server(
        home.path(),
        "claude",
        &HarnessPlanResolver,
        Some("https://new-server.example"),
    )
    .expect("render");

    assert!(
        rendered.set.is_empty(),
        "a state file stamped for a different server must not inject its gateway token, got {:?}",
        rendered.set
    );
}

#[test]
fn legacy_unstamped_state_still_injects_no_regression() {
    // Backward compat: a state file written before `issuing_server_origin`
    // existed has no stamp at all. Single-server desktops (the overwhelming
    // majority) must see zero behavior change.
    let home = TempHome::new("origin-legacy-unstamped");
    home.write_state_json(&stamped_gateway_state("claude", None));

    let rendered = super::resolve_launch_route_auth_for_server(
        home.path(),
        "claude",
        &HarnessPlanResolver,
        Some("https://proliferate.corp.example"),
    )
    .expect("render");

    assert_eq!(rendered.set.get("ANTHROPIC_AUTH_TOKEN").unwrap(), VK);
}

#[test]
fn absent_current_origin_signal_still_injects_no_regression() {
    // No env-var signal at all (e.g. a cloud sandbox launch, or a desktop
    // build that hasn't wired the origin env var) -> never second-guess the
    // state file.
    let home = TempHome::new("origin-no-signal");
    home.write_state_json(&stamped_gateway_state(
        "claude",
        Some("https://proliferate.corp.example"),
    ));

    let rendered =
        super::resolve_launch_route_auth_for_server(home.path(), "claude", &HarnessPlanResolver, None)
            .expect("render");

    assert_eq!(rendered.set.get("ANTHROPIC_AUTH_TOKEN").unwrap(), VK);
}
