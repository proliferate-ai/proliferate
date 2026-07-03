//! `install_workspace_archive` install-mode + re-adopt integration tests
//! (and their real-`AppState` test harness). Split out of `service.rs` — see
//! `service_tests.rs` for the validation tests — to keep each file under the
//! repo max-lines cap; compiled as a child of `service` via `#[path]` so
//! `use super::*` still reaches its private items.

use super::*;

// --- install_workspace_archive: install-mode + re-adopt behavior -----
//
// These exercise the real `MobilityService` (wired through `AppState`,
// same as production) rather than re-deriving its plumbing by hand, per
// `AppState::new`'s existing test-safety (`app/tests.rs`): no background
// work runs except the review-hook listener, which idles harmlessly.

use crate::app::AppState;
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::persistence::Db;
use std::process::Command;

struct MobilityServiceTestDir {
    path: PathBuf,
}

impl MobilityServiceTestDir {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-mobility-service-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for MobilityServiceTestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn install_test_run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn install_test_git_stdout<const N: usize>(cwd: &Path, args: [&str; N]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn install_test_init_repo(path: &Path) {
    install_test_run_git(path, ["init", "-b", "main"]);
    install_test_run_git(
        path,
        ["config", "user.email", "mobility-install-test@example.com"],
    );
    install_test_run_git(path, ["config", "user.name", "Mobility Install Test"]);
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    install_test_run_git(path, ["add", "README.md"]);
    install_test_run_git(path, ["commit", "-m", "Initial commit"]);
}

/// Builds a real, fully-wired `AppState` against a fresh in-memory DB —
/// the same construction path production uses — so `install_workspace_archive`
/// runs with its actual collaborators instead of a hand-rolled double.
fn build_install_test_state(runtime_home: &Path) -> AppState {
    let _lock = crate::app::test_support::ENV_MUTEX
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _bearer_guard = crate::app::test_support::set_bearer_token_env(None);
    let _data_key_guard = crate::app::test_support::set_data_key_env(None);
    AppState::new(
        runtime_home.to_path_buf(),
        "http://127.0.0.1:0".to_string(),
        Db::open_in_memory().expect("open in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("build mobility install test app state")
}

/// Fresh destination workspace (real git repo, clean HEAD) plus the app
/// state wired against it. Guards must outlive the test.
fn build_install_destination(
    prefix: &str,
) -> (
    MobilityServiceTestDir,
    MobilityServiceTestDir,
    AppState,
    WorkspaceRecord,
    String,
) {
    let repo_dir = MobilityServiceTestDir::new(&format!("{prefix}-repo"));
    let runtime_home = MobilityServiceTestDir::new(&format!("{prefix}-home"));
    install_test_init_repo(repo_dir.path());
    let state = build_install_test_state(runtime_home.path());
    let workspace = state
        .workspace_runtime
        .create_workspace(&repo_dir.path().display().to_string())
        .expect("create destination workspace")
        .workspace;
    let base_commit_sha = install_test_git_stdout(repo_dir.path(), ["rev-parse", "HEAD"]);
    (repo_dir, runtime_home, state, workspace, base_commit_sha)
}

fn install_test_session(
    id: &str,
    workspace_id: &str,
    agent_kind: &str,
    native_session_id: Option<&str>,
    title: &str,
) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: agent_kind.to_string(),
        native_session_id: native_session_id.map(str::to_string),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: Some(title.to_string()),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: "2026-07-02T00:00:00Z".to_string(),
        updated_at: "2026-07-02T00:00:00Z".to_string(),
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

/// `install_workspace_archive` calls the terminal manager's `_blocking`
/// accessors, which panic if invoked directly on a Tokio task thread
/// (`tokio::sync::RwLock::blocking_read` refuses to run inside an async
/// context). Production always reaches this through `spawn_blocking`
/// (`api/http/mobility.rs`); mirror that here instead of calling the
/// service straight from the `#[tokio::test]` body.
async fn install_archive_blocking(
    state: &AppState,
    workspace_id: &str,
    archive: &WorkspaceMobilityArchiveData,
    install_mode: MobilityInstallMode,
) -> Result<ImportedWorkspaceArchiveSummary, MobilityError> {
    let mobility_service = state.mobility_service.clone();
    let workspace_id = workspace_id.to_string();
    let archive = archive.clone();
    tokio::task::spawn_blocking(move || {
        mobility_service.install_workspace_archive(&workspace_id, &archive, None, install_mode)
    })
    .await
    .expect("install_workspace_archive task join")
}

fn install_test_archive(
    workspace: &WorkspaceRecord,
    base_commit_sha: &str,
    sessions: Vec<SessionRecord>,
) -> WorkspaceMobilityArchiveData {
    WorkspaceMobilityArchiveData {
        source_workspace_id: None,
        source_workspace_path: "/dummy/mobility-source".to_string(),
        repo_root_path: workspace.path.clone(),
        branch_name: Some("main".to_string()),
        base_commit_sha: base_commit_sha.to_string(),
        files: Vec::new(),
        deleted_paths: Vec::new(),
        sessions: sessions
            .into_iter()
            .map(|session| WorkspaceMobilitySessionBundleData {
                session,
                live_config_snapshot: None,
                pending_config_changes: Vec::new(),
                pending_prompts: Vec::new(),
                prompt_attachments: Vec::new(),
                events: Vec::new(),
                raw_notifications: Vec::new(),
                agent_artifacts: Vec::new(),
            })
            .collect(),
        session_links: Vec::new(),
        session_link_completions: Vec::new(),
        session_link_wake_schedules: Vec::new(),
    }
}

/// Like [`install_test_archive`] but attaches real agent artifacts to each
/// session bundle, so the install path exercises artifact materialization.
fn install_test_archive_with_artifacts(
    workspace: &WorkspaceRecord,
    base_commit_sha: &str,
    sessions: Vec<(SessionRecord, Vec<AgentArtifactFileData>)>,
) -> WorkspaceMobilityArchiveData {
    WorkspaceMobilityArchiveData {
        source_workspace_id: None,
        source_workspace_path: "/dummy/mobility-source".to_string(),
        repo_root_path: workspace.path.clone(),
        branch_name: Some("main".to_string()),
        base_commit_sha: base_commit_sha.to_string(),
        files: Vec::new(),
        deleted_paths: Vec::new(),
        sessions: sessions
            .into_iter()
            .map(
                |(session, agent_artifacts)| WorkspaceMobilitySessionBundleData {
                    session,
                    live_config_snapshot: None,
                    pending_config_changes: Vec::new(),
                    pending_prompts: Vec::new(),
                    prompt_attachments: Vec::new(),
                    events: Vec::new(),
                    raw_notifications: Vec::new(),
                    agent_artifacts,
                },
            )
            .collect(),
        session_links: Vec::new(),
        session_link_completions: Vec::new(),
        session_link_wake_schedules: Vec::new(),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn install_workspace_archive_mirrors_codex_rollout_into_runtime_local_and_ambient_homes() {
    // Regression guard for the Codex twin of the Claude CLAUDE_CONFIG_DIR
    // gap (b0e0495bf): a preserved Codex rollout must be installed into
    // BOTH codex homes the destination runtime may resolve — the
    // runtime-local codex-local home (scanned by native + api_key
    // route-authed cloud launches) AND the ambient ~/.codex — so a
    // route-authed sandbox resume finds the transcript instead of starting
    // a fresh native session.
    let (_repo_dir, runtime_home, state, workspace, base_commit_sha) =
        build_install_destination("codex-mirror");
    let ambient_home = MobilityServiceTestDir::new("codex-mirror-ambient");

    let codex_session = install_test_session(
        "session-codex-mirror",
        &workspace.id,
        "codex",
        Some("native-codex-mirror"),
        "Codex session",
    );
    let rollout = AgentArtifactFileData {
        relative_path: ".codex/sessions/2026/07/rollout-native-codex-mirror.jsonl".to_string(),
        mode: 0o600,
        content: b"{\"codex\":\"rollout\"}\n".to_vec(),
    };
    let archive = install_test_archive_with_artifacts(
        &workspace,
        &base_commit_sha,
        vec![(codex_session, vec![rollout])],
    );

    // Redirect the ambient ~/.codex write into a temp home for the install
    // (serialized via ENV_MUTEX, HOME restored on guard drop) so the test
    // never pollutes the developer's real ~/.codex.
    let summary = {
        let _env = crate::app::test_support::ENV_MUTEX
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _home = crate::app::test_support::set_home_env(Some(ambient_home.path()));
        install_archive_blocking(
            &state,
            &workspace.id,
            &archive,
            MobilityInstallMode::PreserveNativeSessions,
        )
        .await
        .expect("install codex-mirror archive")
    };
    assert_eq!(summary.imported_agent_artifact_count, 1);

    let runtime_local = runtime_home
        .path()
        .join("agent-auth")
        .join("codex-local")
        .join("sessions")
        .join("2026")
        .join("07")
        .join("rollout-native-codex-mirror.jsonl");
    assert!(
        runtime_local.exists(),
        "codex rollout must mirror into the runtime-local codex-local home"
    );
    assert_eq!(
        std::fs::read(&runtime_local).expect("read runtime-local rollout"),
        b"{\"codex\":\"rollout\"}\n"
    );

    let ambient = ambient_home
        .path()
        .join(".codex")
        .join("sessions")
        .join("2026")
        .join("07")
        .join("rollout-native-codex-mirror.jsonl");
    assert!(
        ambient.exists(),
        "codex rollout must also land under the ambient ~/.codex"
    );
    assert_eq!(
        std::fs::read(&ambient).expect("read ambient rollout"),
        b"{\"codex\":\"rollout\"}\n"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn install_workspace_archive_preserve_mode_keeps_native_id_for_supported_kinds_only() {
    let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
        build_install_destination("preserve-mode");

    let claude_session = install_test_session(
        "session-claude-1",
        &workspace.id,
        "claude",
        Some("native-claude-1"),
        "Claude session",
    );
    let codex_session = install_test_session(
        "session-codex-1",
        &workspace.id,
        "codex",
        Some("native-codex-1"),
        "Codex session",
    );
    let gemini_session = install_test_session(
        "session-gemini-1",
        &workspace.id,
        "gemini",
        Some("native-gemini-1"),
        "Gemini session",
    );
    let archive = install_test_archive(
        &workspace,
        &base_commit_sha,
        vec![claude_session, codex_session, gemini_session],
    );

    let summary = install_archive_blocking(
        &state,
        &workspace.id,
        &archive,
        MobilityInstallMode::PreserveNativeSessions,
    )
    .await
    .expect("install preserve-mode archive");
    assert_eq!(summary.imported_session_ids.len(), 3);

    let claude_installed = state
        .session_service
        .get_session("session-claude-1")
        .expect("query claude session")
        .expect("claude session exists");
    assert_eq!(
        claude_installed.native_session_id.as_deref(),
        Some("native-claude-1"),
        "claude is a supported kind: preserve mode must keep its native id"
    );

    let codex_installed = state
        .session_service
        .get_session("session-codex-1")
        .expect("query codex session")
        .expect("codex session exists");
    assert_eq!(
        codex_installed.native_session_id.as_deref(),
        Some("native-codex-1"),
        "codex is a supported kind: preserve mode must keep its native id"
    );

    let gemini_installed = state
        .session_service
        .get_session("session-gemini-1")
        .expect("query gemini session")
        .expect("gemini session exists");
    assert_eq!(
        gemini_installed.native_session_id, None,
        "unsupported kinds always start fresh, even under preserve mode"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn install_workspace_archive_fresh_native_default_nulls_supported_kind_ids() {
    let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
        build_install_destination("fresh-native");

    let claude_session = install_test_session(
        "session-claude-2",
        &workspace.id,
        "claude",
        Some("native-claude-2"),
        "Claude session",
    );
    let codex_session = install_test_session(
        "session-codex-2",
        &workspace.id,
        "codex",
        Some("native-codex-2"),
        "Codex session",
    );
    let archive = install_test_archive(
        &workspace,
        &base_commit_sha,
        vec![claude_session, codex_session],
    );

    install_archive_blocking(
        &state,
        &workspace.id,
        &archive,
        MobilityInstallMode::default(),
    )
    .await
    .expect("install fresh-native (default) archive");

    let claude_installed = state
        .session_service
        .get_session("session-claude-2")
        .expect("query claude session")
        .expect("claude session exists");
    assert_eq!(
        claude_installed.native_session_id, None,
        "fresh_native is the default and byte-for-byte matches v1 behavior: always null"
    );

    let codex_installed = state
        .session_service
        .get_session("session-codex-2")
        .expect("query codex session")
        .expect("codex session exists");
    assert_eq!(codex_installed.native_session_id, None);
}

#[tokio::test(flavor = "current_thread")]
async fn install_workspace_archive_readopts_stale_remote_owned_session_copy() {
    let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
        build_install_destination("readopt");

    // This destination is the workspace's own prior home: it moved away
    // (remote_owned) and is now coming back on a round trip.
    state
        .workspace_access_gate
        .set_runtime_state(&workspace.id, WorkspaceAccessMode::RemoteOwned, None)
        .expect("mark destination as remote_owned prior home");

    let stale_session = install_test_session(
        "session-return",
        &workspace.id,
        "claude",
        Some("native-stale"),
        "STALE",
    );
    state
        .session_service
        .store()
        .insert(&stale_session)
        .expect("seed stale leftover session copy");

    let archived_session = install_test_session(
        "session-return",
        &workspace.id,
        "claude",
        Some("native-fresh"),
        "FRESH",
    );
    let archive = install_test_archive(&workspace, &base_commit_sha, vec![archived_session]);

    let summary = install_archive_blocking(
        &state,
        &workspace.id,
        &archive,
        MobilityInstallMode::PreserveNativeSessions,
    )
    .await
    .expect("re-adopt archive over the stale remote_owned copy");
    assert_eq!(
        summary.imported_session_ids,
        vec!["session-return".to_string()]
    );

    let installed = state
        .session_service
        .get_session("session-return")
        .expect("query readopted session")
        .expect("session exists after readopt");
    assert_eq!(
        installed.title.as_deref(),
        Some("FRESH"),
        "the archive is authoritative over the stale local copy"
    );
    assert_eq!(installed.native_session_id.as_deref(), Some("native-fresh"));

    let rows = state
        .session_service
        .store()
        .list_by_workspace(&workspace.id)
        .expect("list destination sessions");
    assert_eq!(
        rows.len(),
        1,
        "readopt must replace, not duplicate, the stale row"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn install_workspace_archive_rejects_duplicate_session_on_normal_destination() {
    let (_repo_dir, _runtime_home, state, workspace, base_commit_sha) =
        build_install_destination("normal-duplicate");

    // Normal (not remote_owned/retired) destination: it is not this
    // workspace's prior home, so an existing session blocks the install
    // outright instead of being treated as a round trip.
    let existing_session = install_test_session(
        "session-dup",
        &workspace.id,
        "claude",
        Some("native-existing"),
        "EXISTING",
    );
    state
        .session_service
        .store()
        .insert(&existing_session)
        .expect("seed existing session on normal destination");

    let incoming_session = install_test_session(
        "session-dup",
        &workspace.id,
        "claude",
        Some("native-incoming"),
        "INCOMING",
    );
    let archive = install_test_archive(&workspace, &base_commit_sha, vec![incoming_session]);

    let error = install_archive_blocking(
        &state,
        &workspace.id,
        &archive,
        MobilityInstallMode::PreserveNativeSessions,
    )
    .await
    .expect_err("a normal-state duplicate must be rejected");
    assert!(
        matches!(error, MobilityError::Invalid(_)),
        "unexpected error: {error:?}"
    );

    let unchanged = state
        .session_service
        .get_session("session-dup")
        .expect("query existing session")
        .expect("existing session still present");
    assert_eq!(unchanged.title.as_deref(), Some("EXISTING"));
}
