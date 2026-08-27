//! Cursor's `api_key` route, end to end through the real render plane.
//!
//! agent-auth.md's Current gaps: *"Cursor selections are rejected server-side.
//! `selection_rules.py` lists cursor as native-only and the store's harness
//! allow-list excludes it, even though the registry declares `CURSOR_API_KEY` as
//! its credential slot; the `api_key` source needs enabling for cursor end to end
//! (rules, allow-list, **recipe already generic**)."*
//!
//! "Recipe already generic" is the claim these tests make executable. Enabling
//! cursor is a server + UI change (Track B/C); the runtime side is a claim that it
//! needs no per-harness work, and an unverified claim is how the next reader ends
//! up adding a carve-out "just in case". So: pin the generic path for cursor
//! specifically, and pin that the ONE cursor branch in the render plane (no
//! gateway route) is the only one — a future carve-out has to break a test.
//!
//! Split from `render_tests.rs` for the repo line-count ceiling; nested inside it
//! so its `TempHome`, state-builder, and resolver helpers are in scope.

use super::*;
use crate::domains::agent_auth::route_auth::RouteAuthError;

/// The `api_key` route is one line of generic code (`rendered.set(env_var_name,
/// value)`), so cursor gets exactly its registry-declared var, nothing else, and
/// no files or removals — the same shape codex/grok/opencode assert.
#[test]
fn cursor_api_key_sets_exactly_its_var() {
    let home = TempHome::new("cursor-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "cursor",
            vec![api_key_source("CURSOR_API_KEY", "cur-raw")],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "cursor", &HarnessPlanResolver).expect("render");

    assert_eq!(rendered.set.get("CURSOR_API_KEY").unwrap(), "cur-raw");
    assert_eq!(rendered.set.len(), 1, "no extra env for cursor");
    assert!(
        rendered.remove.is_empty(),
        "cursor needs no ambient sanitization"
    );
    assert!(
        rendered.files.is_empty(),
        "cursor needs no materialized config file"
    );
}

/// The env var name is carried by the source, not by a per-harness table, so an
/// operator-chosen var renders verbatim for cursor exactly as for every other
/// harness. This is what makes the recipe generic rather than
/// coincidentally-correct for one var name.
#[test]
fn cursor_api_key_honors_whatever_var_the_source_names() {
    let home = TempHome::new("cursor-key-alt");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "cursor",
            vec![api_key_source("SOME_OTHER_CURSOR_VAR", "cur-alt")],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "cursor", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered.set.get("SOME_OTHER_CURSOR_VAR").unwrap(),
        "cur-alt"
    );
    assert!(!rendered.set.contains_key("CURSOR_API_KEY"));
}

/// Native is still the absence of rows for cursor: a state file that configures
/// another harness must leave cursor launching on its own login, not error.
#[test]
fn cursor_without_rows_renders_a_native_delta() {
    let home = TempHome::new("cursor-native");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![api_key_source("ANTHROPIC_API_KEY", "sk-a")],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "cursor", &HarnessPlanResolver).expect("render");

    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
    assert!(rendered.files.is_empty());
}

/// The one legitimate cursor branch, pinned so it stays the only one: cursor has
/// no gateway story (it is native-only in the gateway's access groups per R1), so
/// a gateway source for it is a typed `UnsupportedRoute` — fail-closed, never a
/// silent native fallback that would bill the user's own Cursor account.
#[test]
fn a_cursor_gateway_source_is_a_typed_unsupported_route() {
    let home = TempHome::new("cursor-gateway");
    home.write_state_json(&v2_state(
        1,
        vec![harness("cursor", vec![gateway_source()])],
    ));

    let error = resolve_launch_route_auth(home.path(), "cursor", &HarnessPlanResolver)
        .expect_err("cursor has no gateway route");

    assert!(
        matches!(
            &error,
            RouteAuthError::UnsupportedRoute { harness_kind, .. } if harness_kind == "cursor"
        ),
        "expected a typed UnsupportedRoute for cursor, got {error:?}"
    );
}
