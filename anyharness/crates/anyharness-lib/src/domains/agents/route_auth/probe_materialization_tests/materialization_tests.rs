//! T-05..T-15: materialization under a substituted root, GC isolation,
//! permissions, cleanup, the origin guard and secret hygiene.

use super::super::*;
use super::*;

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
