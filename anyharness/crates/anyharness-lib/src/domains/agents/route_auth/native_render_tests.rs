//! The NATIVE recipe table: what a launch on the user's own login renders.
//!
//! Native used to mean "an empty delta, always", with codex's isolated home built
//! by a separate `launch_env.rs` path from a Rust constant pinning
//! `model = "gpt-5.5"`. That was written on EVERY codex launch, including
//! gateway-routed ones where route-auth's own `CODEX_HOME` shadowed it — leaving
//! a copy of the user's `auth.json` on disk for launches that never read it.
//!
//! Folding the native codex home into this table is what makes the two cases
//! comparable, so these tests assert both halves: codex renders its config from
//! the CATALOG, and every other harness still renders nothing.
//!
//! Split from `render_tests.rs` for the line-count ceiling; nested inside it so
//! its `TempHome` and resolver helpers are in scope.

use super::*;

/// A resolver carrying only a native default, to prove the native arm reads
/// `native_default_model` and not the gateway's `default_model`.
struct NativeOnlyResolver {
    native_default_model: Option<String>,
}

impl GatewayModelResolve for NativeOnlyResolver {
    fn resolve_gateway_models(&self, _harness_kind: &str, _revision: i64) -> GatewayModelPlan {
        GatewayModelPlan {
            native_default_model: self.native_default_model.clone(),
            // Deliberately set, and deliberately different: if the native arm
            // ever reads this instead, the assertions below catch it.
            default_model: Some("gateway-model-must-not-appear".to_string()),
            ..Default::default()
        }
    }
}

fn native_resolver(native_default_model: &str) -> NativeOnlyResolver {
    NativeOnlyResolver {
        native_default_model: Some(native_default_model.to_string()),
    }
}

/// A native codex launch gets an isolated `CODEX_HOME` whose `config.toml` pins
/// the CATALOG's native default model — no provider table (codex owns the
/// credential), and no model name from Rust.
#[test]
fn native_codex_renders_a_catalog_pinned_config_in_an_isolated_home() {
    let home = TempHome::new("codex-native");
    // No state file at all: the most native case there is.
    let rendered =
        resolve_launch_route_auth(home.path(), "codex", &native_resolver("gpt-5.5")).expect("render");

    let codex_home = rendered.set.get("CODEX_HOME").expect("CODEX_HOME");
    assert!(
        codex_home.ends_with("agent-auth/codex-native"),
        "native home must be the stable codex-native dir, got {codex_home}"
    );
    // Stable, NOT revision-keyed: a revision-keyed native home would be a GC
    // target for a later routed launch of the same family.
    assert!(!codex_home.contains("codex-home-"));

    let config = std::fs::read_to_string(std::path::Path::new(codex_home).join("config.toml"))
        .expect("read config.toml");
    assert_eq!(
        config, "model = \"gpt-5.5\"\n",
        "the native config pins only the catalog's model"
    );
    assert!(
        !config.contains("model_provider"),
        "a native launch must not point codex at a provider we configured"
    );
    assert!(!config.contains("gateway-model-must-not-appear"));

    // The old implementation copied the user's auth.json into its isolated home.
    // Nothing writes credential material here now — codex resolves its own login.
    assert!(!std::path::Path::new(codex_home).join("auth.json").exists());
    assert!(rendered.remove.is_empty(), "a native launch removes nothing");
}

/// The native home is re-rendered per launch and is idempotent — it must not
/// accumulate or need GC, which is why it can be stable rather than
/// revision-keyed.
#[test]
fn a_repeated_native_codex_launch_rewrites_the_same_home() {
    let home = TempHome::new("codex-native-repeat");

    let first =
        resolve_launch_route_auth(home.path(), "codex", &native_resolver("gpt-5.5")).expect("first");
    let second = resolve_launch_route_auth(home.path(), "codex", &native_resolver("gpt-5.6"))
        .expect("second");

    assert_eq!(first.set.get("CODEX_HOME"), second.set.get("CODEX_HOME"));
    let codex_home = second.set.get("CODEX_HOME").expect("CODEX_HOME");
    let config = std::fs::read_to_string(std::path::Path::new(codex_home).join("config.toml"))
        .expect("read config.toml");
    assert_eq!(
        config, "model = \"gpt-5.6\"\n",
        "the latest catalog default wins; the home is rewritten, not appended to"
    );
}

/// A catalog with no native default for codex renders NOTHING rather than a
/// hardcoded fallback. This is the honest degradation: the missing catalog value
/// is exactly what the deleted Rust constant was papering over, and unlike the
/// gateway route a native launch can proceed on the CLI's own config.
#[test]
fn native_codex_without_a_catalog_default_renders_nothing() {
    let home = TempHome::new("codex-native-no-default");
    let resolver = NativeOnlyResolver {
        native_default_model: None,
    };

    let rendered = resolve_launch_route_auth(home.path(), "codex", &resolver).expect("render");

    assert!(rendered.set.is_empty(), "no CODEX_HOME to point at nothing");
    assert!(rendered.files.is_empty());
    assert!(!home.path().join("agent-auth/codex-native").exists());
}

/// Every other harness's native launch is still an empty delta: their CLIs find
/// their own credentials and their own config, and injecting anything would
/// misrepresent what the user selected.
#[test]
fn every_other_harnesss_native_launch_is_an_empty_delta() {
    for harness_kind in ["claude", "opencode", "cursor", "grok"] {
        let home = TempHome::new(&format!("native-{harness_kind}"));
        let rendered = resolve_launch_route_auth(home.path(), harness_kind, &native_resolver("m"))
            .expect("render");

        assert!(
            rendered.set.is_empty() && rendered.remove.is_empty() && rendered.files.is_empty(),
            "{harness_kind} native should render nothing, got {rendered:?}"
        );
    }
}

/// The native and routed codex homes are DIFFERENT directories, so a native and a
/// routed session can run side by side and neither GC's the other. The old
/// implementation wrote both on the same launch and let one shadow the other.
#[test]
fn the_native_and_routed_codex_homes_do_not_collide() {
    let home = TempHome::new("codex-both-homes");

    let native =
        resolve_launch_route_auth(home.path(), "codex", &native_resolver("gpt-5.5")).expect("native");
    let native_home = native.set.get("CODEX_HOME").expect("native CODEX_HOME").clone();

    home.write_state_json(&gateway_state("codex"));
    let routed =
        resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("routed");
    let routed_home = routed.set.get("CODEX_HOME").expect("routed CODEX_HOME");

    assert_ne!(&native_home, routed_home);
    // Both configs survive: the routed launch's revision GC never touches the
    // stable native family.
    assert!(std::path::Path::new(&native_home).join("config.toml").exists());
    assert!(std::path::Path::new(routed_home).join("config.toml").exists());
    // And they are genuinely different recipes, not the same file twice.
    let routed_config =
        std::fs::read_to_string(std::path::Path::new(routed_home).join("config.toml")).unwrap();
    assert!(routed_config.contains("model_provider = \"proliferate\""));
}
