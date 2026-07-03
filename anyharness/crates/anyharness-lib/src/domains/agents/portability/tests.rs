use super::*;
use crate::domains::sessions::model::SessionMcpBindingPolicy;
use std::time::{SystemTime, UNIX_EPOCH};

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "anyharness-portability-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn codex_session(native_session_id: &str) -> SessionRecord {
    SessionRecord {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "codex".to_string(),
        native_session_id: Some(native_session_id.to_string()),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "ended".to_string(),
        created_at: "2026-05-30T00:00:00Z".to_string(),
        updated_at: "2026-05-30T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: false,
        action_capabilities_json: None,
        origin: None,
    }
}

fn claude_session(native_session_id: &str) -> SessionRecord {
    SessionRecord {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: Some(native_session_id.to_string()),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "ended".to_string(),
        created_at: "2026-05-30T00:00:00Z".to_string(),
        updated_at: "2026-05-30T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: false,
        action_capabilities_json: None,
        origin: None,
    }
}

#[test]
fn claude_artifacts_round_trip_across_workspace_slug_rewrite() {
    // Only Codex's collect path is covered above; Claude re-slugs every
    // artifact path onto the destination workspace (collect :135-160,
    // install :162-187 / rewrite_claude_relative_path :309-333) and had
    // no round-trip test.
    let home = TempDirGuard::new("claude-slug-roundtrip");
    let native_session_id = "native-claude-abc";
    let source_workspace_path = Path::new("/tmp/mobility-source-workspace-one");
    let source_slug = sanitize_claude_path(&source_workspace_path.to_string_lossy());

    let source_project_dir = home
        .path()
        .join(".claude")
        .join("projects")
        .join(&source_slug);
    fs::create_dir_all(&source_project_dir).expect("create source project dir");
    let transcript_path = source_project_dir.join(format!("{native_session_id}.jsonl"));
    fs::write(&transcript_path, b"{\"line\":1}\n").expect("write transcript");
    let session_subdir = source_project_dir.join(native_session_id);
    fs::create_dir_all(&session_subdir).expect("create session subdir");
    fs::write(session_subdir.join("extra.json"), b"{\"nested\":true}\n")
        .expect("write nested artifact");

    let session = claude_session(native_session_id);

    let collected = collect_claude_artifacts(home.path(), &session, source_workspace_path)
        .expect("collect claude artifacts from the source slug");
    assert_eq!(collected.len(), 2);
    let expected_prefix = format!(".claude/projects/{source_slug}/");
    assert!(
        collected
            .iter()
            .all(|file| file.relative_path.starts_with(&expected_prefix)),
        "collected artifacts must be rooted under the source slug: {collected:?}"
    );

    let destination_workspace_path = Path::new("/tmp/mobility-destination-workspace-two");
    let destination_slug = sanitize_claude_path(&destination_workspace_path.to_string_lossy());
    assert_ne!(
        source_slug, destination_slug,
        "the test must exercise an actual slug rewrite"
    );

    let runtime_home = TempDirGuard::new("claude-slug-roundtrip-runtime");
    install_claude_artifacts(
        home.path(),
        destination_workspace_path,
        &collected,
        Some(runtime_home.path()),
    )
    .expect("install claude artifacts under the destination slug");

    let destination_project_dir = home
        .path()
        .join(".claude")
        .join("projects")
        .join(&destination_slug);
    let destination_transcript = destination_project_dir.join(format!("{native_session_id}.jsonl"));
    assert!(
        destination_transcript.exists(),
        "main transcript must land under the destination slug"
    );
    assert_eq!(
        fs::read(&destination_transcript).expect("read destination transcript"),
        b"{\"line\":1}\n"
    );
    let destination_nested = destination_project_dir
        .join(native_session_id)
        .join("extra.json");
    assert!(
        destination_nested.exists(),
        "nested session artifacts must land under the destination slug"
    );

    // The isolated CLAUDE_CONFIG_DIR mirror must carry the same re-slugged
    // tree (a route-authed launch resumes from here, not ~/.claude).
    let config_project_dir = runtime_home
        .path()
        .join("agent-auth")
        .join("claude-config")
        .join("projects")
        .join(&destination_slug);
    let config_transcript = config_project_dir.join(format!("{native_session_id}.jsonl"));
    assert!(
        config_transcript.exists(),
        "main transcript must also mirror into the isolated CLAUDE_CONFIG_DIR"
    );
    assert_eq!(
        fs::read(&config_transcript).expect("read config-dir transcript"),
        b"{\"line\":1}\n"
    );
    assert!(
        config_project_dir
            .join(native_session_id)
            .join("extra.json")
            .exists(),
        "nested session artifacts must also mirror into the isolated CLAUDE_CONFIG_DIR"
    );
    assert_eq!(
        fs::read(&destination_nested).expect("read nested destination artifact"),
        b"{\"nested\":true}\n"
    );

    // Install only copies into the new slug; it must not touch the
    // source slug's own files.
    assert!(transcript_path.exists());
}

#[test]
fn delete_claude_artifacts_removes_home_and_config_dir_mirror() {
    // Symmetry regression: install with a runtime_home lays the transcript
    // down in BOTH ~/.claude/projects/<slug> and the isolated
    // CLAUDE_CONFIG_DIR mirror
    // (<runtime_home>/agent-auth/claude-config/projects/<slug>). Delete must
    // sweep BOTH, or destroy-source leaks the migrated conversation under
    // the config dir indefinitely (the claude twin of delete_codex_artifacts,
    // which already sweeps every codex_artifact_root). $HOME is redirected so
    // delete's dirs::home_dir() resolves to the temp home.
    let _env = crate::app::test_support::ENV_MUTEX
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .expect("env mutex");
    let home = TempDirGuard::new("claude-delete-home");
    let _home_guard = crate::app::test_support::set_home_env(Some(home.path()));

    let native_session_id = "native-claude-delete";
    let workspace_path = Path::new("/tmp/mobility-delete-workspace");
    let slug = sanitize_claude_path(&workspace_path.to_string_lossy());

    // Seed the source transcript so collect finds it, then install into the
    // same workspace path with a runtime_home to lay down both copies.
    let project_dir = home.path().join(".claude").join("projects").join(&slug);
    fs::create_dir_all(&project_dir).expect("create project dir");
    fs::write(
        project_dir.join(format!("{native_session_id}.jsonl")),
        b"{\"line\":1}\n",
    )
    .expect("write transcript");

    let session = claude_session(native_session_id);
    let collected = collect_claude_artifacts(home.path(), &session, workspace_path)
        .expect("collect claude artifacts");
    assert_eq!(collected.len(), 1);

    let runtime_home = TempDirGuard::new("claude-delete-runtime");
    install_claude_artifacts(
        home.path(),
        workspace_path,
        &collected,
        Some(runtime_home.path()),
    )
    .expect("install claude artifacts into both roots");

    let home_transcript = project_dir.join(format!("{native_session_id}.jsonl"));
    let config_transcript = runtime_home
        .path()
        .join("agent-auth")
        .join("claude-config")
        .join("projects")
        .join(&slug)
        .join(format!("{native_session_id}.jsonl"));
    assert!(
        home_transcript.exists(),
        "home copy must exist after install"
    );
    assert!(
        config_transcript.exists(),
        "config-dir mirror must exist after install"
    );

    delete_session_agent_artifacts(&session, workspace_path, Some(runtime_home.path()))
        .expect("delete claude artifacts from both roots");

    assert!(
        !home_transcript.exists(),
        "delete must remove the ~/.claude copy"
    );
    assert!(
        !config_transcript.exists(),
        "delete must ALSO remove the CLAUDE_CONFIG_DIR mirror (regression)"
    );
}

#[test]
fn collect_codex_artifacts_skips_missing_rollout_file() {
    let home = TempDirGuard::new("missing-codex-rollout");
    let session = codex_session("native-123");

    let artifacts = codex::collect_codex_artifacts(home.path(), None, &session)
        .expect("missing rollout should not fail");

    assert!(artifacts.is_empty());
}

#[test]
fn collect_codex_artifacts_reads_matching_rollout_file() {
    let home = TempDirGuard::new("codex-rollout");
    let session = codex_session("native-123");
    let rollout_dir = home.path().join(".codex").join("sessions").join("2026");
    fs::create_dir_all(&rollout_dir).expect("create rollout dir");
    let rollout_path = rollout_dir.join("rollout-native-123.jsonl");
    fs::write(&rollout_path, b"{\"event\":\"ok\"}\n").expect("write rollout");

    let artifacts = codex::collect_codex_artifacts(home.path(), None, &session)
        .expect("collect rollout artifact");

    assert_eq!(artifacts.len(), 1);
    assert_eq!(
        artifacts[0].relative_path,
        ".codex/sessions/2026/rollout-native-123.jsonl"
    );
    assert_eq!(artifacts[0].content, b"{\"event\":\"ok\"}\n");
}

#[test]
fn collect_codex_artifacts_reads_runtime_local_codex_home() {
    let home = TempDirGuard::new("codex-empty-home");
    let runtime_home = TempDirGuard::new("codex-runtime-home");
    let session = codex_session("native-123");
    let rollout_dir = runtime_home
        .path()
        .join("agent-auth")
        .join("codex-local")
        .join("sessions")
        .join("2026");
    fs::create_dir_all(&rollout_dir).expect("create runtime rollout dir");
    fs::write(rollout_dir.join("rollout-native-123.jsonl"), b"runtime\n")
        .expect("write runtime rollout");

    let artifacts =
        codex::collect_codex_artifacts(home.path(), Some(runtime_home.path()), &session)
            .expect("collect runtime rollout artifact");

    assert_eq!(artifacts.len(), 1);
    assert_eq!(
        artifacts[0].relative_path,
        ".codex/sessions/2026/rollout-native-123.jsonl"
    );
    assert_eq!(artifacts[0].content, b"runtime\n");
}

#[test]
fn collect_codex_artifacts_canonicalizes_runtime_home_under_home_dir() {
    // Regression: in a cloud sandbox the runtime home lives UNDER the user
    // home (~/.proliferate/anyharness), so a route-authed codex rollout at
    // <home>/.proliferate/anyharness/agent-auth/codex-local/sessions/... is
    // itself under home_dir. The collected relative_path must still be the
    // canonical .codex/sessions/... (not the on-disk path stripped of home),
    // or install rejects it as escaping .codex/sessions. The prior
    // read_file_relative_to_home shortcut produced the wrong path here.
    let home = TempDirGuard::new("codex-home-with-nested-runtime");
    let runtime_home = home.path().join(".proliferate").join("anyharness");
    let session = codex_session("native-123");
    let rollout_dir = runtime_home
        .join("agent-auth")
        .join("codex-local")
        .join("sessions")
        .join("2026");
    fs::create_dir_all(&rollout_dir).expect("create nested runtime rollout dir");
    fs::write(rollout_dir.join("rollout-native-123.jsonl"), b"nested\n")
        .expect("write nested rollout");

    let artifacts = codex::collect_codex_artifacts(home.path(), Some(&runtime_home), &session)
        .expect("collect nested runtime rollout artifact");

    assert_eq!(artifacts.len(), 1);
    assert_eq!(
        artifacts[0].relative_path,
        ".codex/sessions/2026/rollout-native-123.jsonl"
    );
    assert_eq!(artifacts[0].content, b"nested\n");
}

#[test]
fn collect_codex_artifacts_reroots_codex_local_home_nested_under_home_dir() {
    // Regression guard for the cloud round-trip: in a real sandbox the
    // runtime home (and thus the codex-local CODEX_HOME) lives UNDER $HOME
    // (`/home/user/.proliferate/anyharness/agent-auth/codex-local`), unlike
    // the local test which spawns the runtime in a scratch dir outside
    // $HOME. A collect that shortcut through read_file_relative_to_home
    // whenever the rollout path lived under home_dir mis-rooted it as
    // `.proliferate/anyharness/agent-auth/codex-local/sessions/…` instead of
    // the canonical `.codex/sessions/…`, and the cloud->local install then
    // rejected it as escaping `.codex/sessions`. The path must always be
    // re-rooted from the CODEX_HOME it was found under.
    let home = TempDirGuard::new("codex-nested-home");
    let runtime_home = home.path().join(".proliferate").join("anyharness");
    let session = codex_session("native-123");
    let rollout_dir = runtime_home
        .join("agent-auth")
        .join("codex-local")
        .join("sessions")
        .join("2026");
    fs::create_dir_all(&rollout_dir).expect("create nested runtime rollout dir");
    fs::write(rollout_dir.join("rollout-native-123.jsonl"), b"nested\n")
        .expect("write nested rollout");

    let artifacts =
        codex::collect_codex_artifacts(home.path(), Some(runtime_home.as_path()), &session)
            .expect("collect nested runtime rollout artifact");

    assert_eq!(artifacts.len(), 1);
    assert_eq!(
        artifacts[0].relative_path, ".codex/sessions/2026/rollout-native-123.jsonl",
        "a codex-local rollout nested under $HOME must re-root as .codex/…, \
         not a $HOME-relative .proliferate/… path"
    );
    assert_eq!(artifacts[0].content, b"nested\n");
}

#[test]
fn install_codex_artifacts_writes_to_runtime_local_and_ambient_roots() {
    // Install must be symmetric with collect's codex_artifact_roots: a
    // migrated rollout lands in BOTH the runtime-local codex-local home
    // (the CODEX_HOME a native/api_key route-authed launch scans) and the
    // ambient ~/.codex (native/unrouted destinations). Before this fix
    // install wrote only ~/.codex, so a route-authed sandbox resume found
    // nothing and fell back to a fresh native session.
    let home = TempDirGuard::new("codex-install-home");
    let runtime_home = TempDirGuard::new("codex-install-runtime");
    let file = AgentArtifactFileData {
        relative_path: ".codex/sessions/2026/07/rollout-native-abc.jsonl".to_string(),
        mode: 0o600,
        content: b"{\"event\":\"ok\"}\n".to_vec(),
    };

    codex::install_codex_artifacts(
        home.path(),
        Some(runtime_home.path()),
        std::slice::from_ref(&file),
    )
    .expect("install codex rollout into both roots");

    let ambient = home
        .path()
        .join(".codex")
        .join("sessions")
        .join("2026")
        .join("07")
        .join("rollout-native-abc.jsonl");
    assert!(
        ambient.exists(),
        "rollout must land under the ambient ~/.codex root"
    );
    assert_eq!(
        fs::read(&ambient).expect("read ambient rollout"),
        b"{\"event\":\"ok\"}\n"
    );

    let runtime_local = runtime_home
        .path()
        .join("agent-auth")
        .join("codex-local")
        .join("sessions")
        .join("2026")
        .join("07")
        .join("rollout-native-abc.jsonl");
    assert!(
        runtime_local.exists(),
        "rollout must also mirror into the runtime-local codex-local root"
    );
    assert_eq!(
        fs::read(&runtime_local).expect("read runtime-local rollout"),
        b"{\"event\":\"ok\"}\n"
    );
}

#[test]
fn install_codex_artifacts_without_runtime_home_writes_only_ambient_root() {
    // Native-auth destinations with no runtime-local codex home get the
    // unchanged v1 behavior: the ambient ~/.codex write, and only that.
    let home = TempDirGuard::new("codex-install-ambient-only");
    let file = AgentArtifactFileData {
        relative_path: ".codex/sessions/2026/rollout-native-xyz.jsonl".to_string(),
        mode: 0o600,
        content: b"solo\n".to_vec(),
    };

    codex::install_codex_artifacts(home.path(), None, std::slice::from_ref(&file))
        .expect("install codex rollout into the ambient root");

    assert!(home
        .path()
        .join(".codex")
        .join("sessions")
        .join("2026")
        .join("rollout-native-xyz.jsonl")
        .exists());
}

#[test]
fn install_codex_artifacts_rejects_path_traversal() {
    // The `sessions` allowed-prefix guard must reject a `..` escape for the
    // new runtime-local destination too — nothing may be written outside
    // either codex home.
    let home = TempDirGuard::new("codex-install-traversal-home");
    let runtime_home = TempDirGuard::new("codex-install-traversal-runtime");
    let malicious = AgentArtifactFileData {
        relative_path: ".codex/sessions/../../evil.jsonl".to_string(),
        mode: 0o600,
        content: b"pwned\n".to_vec(),
    };

    let result = codex::install_codex_artifacts(
        home.path(),
        Some(runtime_home.path()),
        std::slice::from_ref(&malicious),
    );
    assert!(
        result.is_err(),
        "a traversal path must be rejected, not written outside sessions/"
    );
    assert!(!runtime_home
        .path()
        .join("agent-auth")
        .join("evil.jsonl")
        .exists());
    assert!(!home.path().join("evil.jsonl").exists());
}

#[test]
fn validate_session_agent_artifacts_rejects_codex_path_traversal() {
    // The pre-install validation gate still rejects a codex traversal path
    // and still accepts a well-formed rollout path unchanged.
    let session = codex_session("native-123");
    let workspace = Path::new("/tmp/mobility-dest");

    let malicious = AgentArtifactFileData {
        relative_path: ".codex/sessions/../../etc/passwd".to_string(),
        mode: 0o600,
        content: Vec::new(),
    };
    assert!(
        validate_session_agent_artifacts(&session, workspace, std::slice::from_ref(&malicious))
            .is_err(),
        "validation must reject a codex traversal path"
    );

    let ok = AgentArtifactFileData {
        relative_path: ".codex/sessions/2026/rollout-native-123.jsonl".to_string(),
        mode: 0o600,
        content: Vec::new(),
    };
    validate_session_agent_artifacts(&session, workspace, std::slice::from_ref(&ok))
        .expect("a well-formed codex rollout path must validate");
}
