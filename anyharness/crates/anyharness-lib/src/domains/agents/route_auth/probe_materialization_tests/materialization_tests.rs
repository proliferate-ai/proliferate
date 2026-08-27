//! Proof B1 (probe env ≡ launch env, modulo the file root) and Proof B4 (the
//! recipes' sanitization is fidelity), plus GC isolation, permissions, cleanup,
//! the origin guard and secret hygiene.

use super::super::*;
use super::*;

/// **Proof B1.** Probe env ≡ launch env modulo the file root, parameterized over
/// every harness × source-combination the recipe table serves.
///
/// For each case: the probe materialization's rendered files are byte-identical
/// to a launch render of the SAME composed profile, the env deltas (set AND
/// remove) are identical, and the only difference is the materialization root.
/// Nothing is added, nothing is subtracted, nothing is scoped to a single source.
#[test]
fn probe_env_equals_launch_env_for_every_harness_and_source_combination() {
    // (harness, sources). The combinations mirror what `state.json` can carry:
    // a gateway route, a raw provider key, and — opencode's real shape — several
    // sources composed at once. Native (no entry at all) is covered separately
    // below because it renders the empty delta.
    let cases: Vec<(&str, Vec<serde_json::Value>)> = vec![
        ("claude", vec![gateway_source(VK)]),
        (
            "claude",
            vec![api_key_source("ANTHROPIC_API_KEY", "sk-byok")],
        ),
        ("codex", vec![gateway_source(VK)]),
        ("codex", vec![api_key_source("OPENAI_API_KEY", "sk-oai")]),
        ("grok", vec![gateway_source(VK)]),
        ("grok", vec![api_key_source("XAI_API_KEY", "sk-xai")]),
        ("opencode", vec![gateway_source(VK)]),
        (
            "opencode",
            vec![
                gateway_source(VK),
                api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                api_key_source("OPENAI_API_KEY", "sk-oai"),
            ],
        ),
    ];

    for (harness, sources) in cases {
        let label = format!("{harness} x {} source(s)", sources.len());
        let home = TempHome::new(&format!("b1-{harness}-{}", sources.len()));
        home.write_state_json(&state(
            5,
            json!([{ "harness_kind": harness, "sources": sources }]),
        ));

        let material = material_for(&home, harness).expect("material");
        let plan = plan_with(&["m-1", "m-2"]);
        let materialized =
            materialize_for_probe(home.path(), harness, &material, &plan).expect("materialize");
        let scratch_root = materialized.scratch.root().to_path_buf();

        // The launch render of the same composed profile, at an arbitrary root.
        let launch_rendered =
            render_profile(material.profile(), harness, &plan, Path::new("/launch-root"))
                .expect("launch render");

        // Env deltas agree exactly, modulo the root substitution in path values.
        assert_eq!(
            materialized.env_remove, launch_rendered.remove,
            "{label}: the removal list must be the launch's, untouched"
        );
        let normalize = |value: &str, root: &Path| {
            value.replace(&root.display().to_string(), "<root>")
        };
        let probe_set: Vec<(String, String)> = materialized
            .env_set
            .iter()
            .map(|(key, value)| (key.clone(), normalize(value, &scratch_root)))
            .collect();
        let launch_set: Vec<(String, String)> = launch_rendered
            .set
            .iter()
            .map(|(key, value)| (key.clone(), normalize(value, Path::new("/launch-root"))))
            .collect();
        assert_eq!(
            probe_set, launch_set,
            "{label}: probe env must equal launch env with only the root moved"
        );

        // File contents agree byte-for-byte across the two roots.
        let probe_rendered = render_profile(material.profile(), harness, &plan, &scratch_root)
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
            "{label}: config bytes must not depend on the materialization root"
        );

        // Every path the probe's env names is under the scratch, and the live
        // agent-auth root gained nothing but the pre-seeded state.json.
        for (key, value) in &materialized.env_set {
            if !value.starts_with('/') {
                continue; // Not a path (a key, a URL, a model id).
            }
            assert!(
                Path::new(value).starts_with(&scratch_root),
                "{label}: {key} points outside the scratch root: {value}"
            );
        }
        let live_entries: Vec<String> = std::fs::read_dir(home.path().join("agent-auth"))
            .expect("read live agent-auth")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            live_entries,
            vec!["state.json".to_string()],
            "{label}: a probe must write nothing into the live agent-auth root"
        );
    }
}

/// **Proof B1's native leg.** A harness with no `state.json` entry resolves to the
/// empty profile — the probe injects nothing, so the observation is of the user's
/// real login, exactly what a session would use. There is no `baseline`
/// pseudo-context and no scrub of the ambient world.
#[test]
fn a_native_harness_materializes_the_empty_delta() {
    let home = TempHome::new("b1-native");
    // No state.json at all: the fresh-desktop shape.
    let material = material_for(&home, "opencode").expect("material");
    assert!(material.is_native());
    assert_eq!(material.state_sequence, 0);

    let materialized = materialize_for_probe(home.path(), "opencode", &material, &plan_with(&[]))
        .expect("materialize");
    assert!(
        materialized.env_set.is_empty(),
        "native injects nothing: the harness's own login owns auth"
    );
    assert!(
        materialized.env_remove.is_empty(),
        "native scrubs nothing: the ambient world IS what a launch sees"
    );
}

/// GC isolation, with the corrected assertion.
///
/// Two halves. (1) A probe's own GC deletes nothing: the scratch is fresh, so
/// "greatest sequence strictly below current" finds no candidate, and the three
/// live dirs are untouched. (2) A subsequent LAUNCH at sequence 8 over live
/// `{5,6,7}` deletes **both 5 AND 6**, not just 5: `gc_old_sequence_dirs` runs
/// BEFORE the sequence-8 dir is created, so the sequences present are `[5,6,7]`,
/// `previous_sequence` is 7, and everything strictly below 7 goes. The keep-window
/// is current-plus-previous relative to what is ON DISK, not to the incoming
/// sequence.
#[test]
fn probe_gc_is_a_no_op_and_the_launch_gc_keeps_only_the_previous_on_disk_sequence() {
    let home = TempHome::new("gc-isolation");
    home.write_state_json(&state(
        7,
        json!([{ "harness_kind": "codex", "sources": [gateway_source(VK)] }]),
    ));
    for sequence in [5, 6, 7] {
        std::fs::create_dir_all(home.path().join(format!("agent-auth/codex-home-{sequence}")))
            .expect("seed live sequence dir");
    }

    let material = material_for(&home, "codex").expect("material");
    let materialized = materialize_for_probe(home.path(), "codex", &material, &plan_with(&["m"]))
        .expect("materialize");

    for sequence in [5, 6, 7] {
        assert!(
            home.path()
                .join(format!("agent-auth/codex-home-{sequence}"))
                .is_dir(),
            "the probe's GC must delete no live sequence dir (codex-home-{sequence})"
        );
    }
    let scratch_sequence_dirs: Vec<String> =
        std::fs::read_dir(materialized.scratch.root().join("agent-auth"))
            .expect("read scratch agent-auth")
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("codex-home-"))
            .collect();
    assert_eq!(
        scratch_sequence_dirs,
        vec!["codex-home-7".to_string()],
        "the scratch holds exactly the probed sequence"
    );

    // Now a launch at sequence 8, which DOES garbage-collect.
    home.write_state_json(&state(
        8,
        json!([{ "harness_kind": "codex", "sources": [gateway_source(VK)] }]),
    ));
    let launch_material = material_for(&home, "codex").expect("launch material");
    let launch_rendered = render_profile(
        launch_material.profile(),
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

/// The claude hazard: `claude-config/` is deliberately NOT sequence-keyed,
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

    let material = material_for(&home, "claude").expect("material");
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

/// Permissions and no tmp residue. The scratch is 0700 BEFORE any content
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
    let material = material_for(&home, "opencode").expect("material");
    let materialized =
        materialize_for_probe(home.path(), "opencode", &material, &plan_with(&["m-1"]))
            .expect("materialize");
    let root = materialized.scratch.root();

    let mode = std::fs::metadata(root)
        .expect("scratch metadata")
        .permissions()
        .mode()
        & 0o777;
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

/// The guard removes the root on every exit path: success, an `Err` return,
/// and an unwind. The unwind case is the one a `defer`-less design gets wrong.
#[test]
fn the_scratch_guard_removes_its_root_on_success_error_and_unwind() {
    let home = TempHome::new("guard");
    home.write_state_json(&state(
        2,
        json!([{ "harness_kind": "grok", "sources": [gateway_source(VK)] }]),
    ));
    let material = material_for(&home, "grok").expect("material");

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
    let unwind_material =
        probe_auth_material_for_server(home.path(), "grok", None).expect("material");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let materialized =
            materialize_for_probe(&home_path, "grok", &unwind_material, &plan_with(&[]))
                .expect("materialize");
        *sink.lock().expect("sink") = Some(materialized.scratch.root().to_path_buf());
        panic!("synthetic panic while holding the guard");
    }));
    assert!(result.is_err(), "the closure must have panicked");
    let root = captured
        .lock()
        .expect("captured")
        .clone()
        .expect("root recorded");
    assert!(!root.exists(), "the root must be gone after an unwind");
}

/// The origin guard: a `state.json` stamped for a DIFFERENT server yields
/// Native, so a desktop mid-server-switch cannot record the abandoned server's
/// gateway model list as this machine's truth.
#[test]
fn a_state_file_from_another_server_yields_no_gateway_material() {
    let home = TempHome::new("origin-guard");
    home.write_state_json(&json!({
        "version": 2,
        "sequence": 9,
        "issuing_server_origin": "https://other.example",
        "harnesses": [{ "harness_kind": "claude", "sources": [gateway_source(VK)] }],
    }));

    let mismatched =
        probe_auth_material_for_server(home.path(), "claude", Some("https://here.example"))
            .expect("material");
    assert!(
        mismatched.is_native(),
        "an abandoned server's state must not materialize"
    );
    // The same input under the matching origin DOES resolve — proving the guard is
    // what made the difference, not a broken fixture.
    let matched =
        probe_auth_material_for_server(home.path(), "claude", Some("https://other.example"))
            .expect("material");
    assert!(!matched.is_native());
}

/// No plaintext leaves the material. The `Debug` impl is hand-written precisely
/// so the privately-held composed profile cannot print a key, and the digests
/// exist solely for the failure-detail redactor.
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

    let material = material_for(&home, "opencode").expect("material");
    let debug = format!("{material:?}");
    assert!(!debug.contains(secret), "Debug output leaked the credential");
    assert!(debug.contains("<redacted>"));
    for digest in &material.env_value_digests {
        assert!(!digest.contains(secret));
        assert_eq!(digest.len(), 64, "digests are hex sha256");
    }
}

/// **Proof B4.** The recipes' sanitization is fidelity: a gateway-routed claude
/// probe on a host exporting `CLAUDE_CODE_USE_BEDROCK` and `ANTHROPIC_API_KEY`
/// records gateway models, not Bedrock's menu, because the launch recipe strips
/// the ambient rerouting flags and the probe runs the same recipe.
///
/// Asserted end to end through the SAME ProbeOptions the engine builds, so a
/// probe_agent that forgot to pass the removals through would fail here.
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
    let material = material_for(&home, "claude").expect("material");
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
    // last, so an ambient/composed value cannot survive.
    let resolved = crate::domains::agents::readiness::service::resolve_agent_unrouted_by_kind(
        &crate::domains::agents::model::AgentKind::Claude,
        home.path(),
    )
    .expect("claude is in the built-in registry");
    let options = crate::domains::agents::live_ports::ProbeOptions {
        agent_kind: crate::domains::agents::model::AgentKind::Claude,
        resolved,
        auth_context: "composed".to_string(),
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
    let merged = crate::domains::agents::live_ports::spawn_env_for_probe(options, &ambient);
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

    // The api_key route on the same harness ALSO carries removals, so its probe
    // is the sanitized one too.
    home.write_state_json(&state(
        4,
        json!([{
            "harness_kind": "claude",
            "sources": [api_key_source("ANTHROPIC_API_KEY", "sk-byok")],
        }]),
    ));
    let api_material = material_for(&home, "claude").expect("material");
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
        api_materialized
            .env_set
            .get("ANTHROPIC_API_KEY")
            .map(String::as_str),
        Some("sk-byok"),
        "and must keep the key it was asked to observe"
    );
}
