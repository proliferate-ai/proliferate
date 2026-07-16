use super::{order_worktrees_by_activity, retention_barriers, should_spawn_startup_pass};
use crate::domains::workspaces::model::{
    WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};

// ── PR1227-RETENTION-FENCE-01: retention is a third workspace-retirement owner ──
//
// Before this fix the retention sweep acquired only the exclusive workspace
// lease, then wrote Retired/Pending and dematerialized the checkout — with NO
// session admission, NO permits, NO workflow-control re-check. Its preflight
// only observes LIVE-actor signals, so a nonterminal workflow whose bound
// session has a dead actor (running step, NULL turn_id, DB-only) presents ZERO
// preflight blockers; retention would retire a workspace that the direct retire
// handler 409s on. These proofs drive the REAL retention pass over the REAL
// controller policy and assert it fails closed (skips) instead.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::workflows::service::WorkflowRunService;
use crate::domains::workflows::store::WorkflowRunStore;
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::persistence::Db;
use anyharness_contract::v1::WorktreeRetentionRowOutcome;

#[test]
fn startup_deferral_is_startup_only_gate() {
    assert!(should_spawn_startup_pass(true, false));
    assert!(!should_spawn_startup_pass(true, true));
    assert!(!should_spawn_startup_pass(false, false));
    assert!(!should_spawn_startup_pass(false, true));
}

#[test]
fn active_worktree_activity_order_uses_true_row_max() {
    let mut workspaces = vec![
        workspace_record("workspace-session-newer"),
        workspace_record("workspace-terminal-newer"),
        workspace_record("workspace-older"),
    ];

    order_worktrees_by_activity(
        &mut workspaces,
        vec![
            (
                "workspace-session-newer".to_string(),
                "2025-01-11T00:00:00Z".to_string(),
            ),
            (
                "workspace-older".to_string(),
                "2025-01-09T00:00:00Z".to_string(),
            ),
        ],
        vec![(
            "workspace-terminal-newer".to_string(),
            "2025-01-10T00:00:00Z".to_string(),
        )],
    );

    let ids = workspaces
        .into_iter()
        .map(|workspace| workspace.id)
        .collect::<Vec<_>>();

    assert_eq!(
        ids,
        vec![
            "workspace-session-newer".to_string(),
            "workspace-terminal-newer".to_string(),
            "workspace-older".to_string(),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retention_skips_workspace_with_dead_actor_workflow_controlled_session() {
    // A nonterminal workflow controls a session whose actor is dead (DB-only,
    // idle status, no live handle) in a retention-eligible workspace. The
    // preflight sees no LIVE-execution blocker, so pre-fix retention would
    // retire it. The FENCE-01 up-front admission conflicts on the nonterminal
    // controller, so the pass must SKIP (Blocked) and the workspace + session
    // must survive.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _bearer_guard = test_support::set_bearer_token_env(None);

    let fixture = RetentionFixture::new("retention-deadactor");
    let candidate = fixture.materialize_candidate();
    fixture.seed_keepers(&candidate.repo_root_id, 10);

    // Bind a nonterminal workflow controller to the candidate's session.
    let session_id = fixture.insert_session(&candidate.id);
    let control = fixture.control_service();
    let run_id = uuid::Uuid::new_v4().to_string();
    control
        .accept(&run_id, fixture.domain_input(&candidate.id))
        .expect("accept controller run");
    assert!(control.begin_run(&run_id).expect("begin_run"));
    assert!(control
        .bind_session(&run_id, &session_id)
        .expect("bind controller session"));

    let result = fixture
        .state
        .workspace_retention_service
        .run_pass(None)
        .await
        .expect("run retention pass");

    let row = result
        .rows
        .iter()
        .find(|row| row.workspace_id == candidate.id)
        .unwrap_or_else(|| panic!("candidate not in retention rows: {:?}", result.rows));
    assert_eq!(
        row.outcome,
        WorktreeRetentionRowOutcome::Blocked,
        "retention must skip (block) the workflow-controlled candidate, got {row:?}"
    );
    assert_eq!(result.retired_count, 0, "nothing may be retired");

    // No effect: the workspace stays Active and materialized; the session lives.
    let reloaded = fixture
        .state
        .workspace_runtime
        .get_workspace(&candidate.id)
        .expect("get workspace")
        .expect("workspace present");
    assert_eq!(
        reloaded.lifecycle_state,
        WorkspaceLifecycleState::Active,
        "retention must not retire the controlled workspace"
    );
    assert!(
        Path::new(&reloaded.path).exists(),
        "retention must not dematerialize the controlled workspace"
    );
    assert!(
        fixture
            .state
            .session_service
            .store()
            .find_by_id(&session_id)
            .expect("find session")
            .is_some(),
        "retention must not delete the controlled session"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retention_skips_workspace_with_session_bound_then_terminalized_after_snapshot() {
    // FENCE-02 analog: a fresh session is bound by a workflow AFTER retention's
    // up-front admission snapshot (parked at the pre-exclusive-lease seam), and
    // its run is driven TERMINAL before the exclusive lease. FENCE-01 is then
    // structurally blind (terminal controller -> None); only the admitted-set
    // membership re-check catches the never-admitted session id, and retention
    // skips.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _bearer_guard = test_support::set_bearer_token_env(None);

    let fixture = RetentionFixture::new("retention-fence2");
    let candidate = fixture.materialize_candidate();
    fixture.seed_keepers(&candidate.repo_root_id, 10);

    // Park the pass between its per-candidate admission snapshot (empty of the
    // not-yet-bound session) and the exclusive lease.
    let (reached_tx, reached_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    retention_barriers::install(
        &candidate.id,
        retention_barriers::RetentionBarrier {
            reached_tx: Some(reached_tx),
            resume_rx: Some(resume_rx),
        },
    );

    let service = fixture.state.workspace_retention_service.clone();
    let pass = tokio::spawn(async move { service.run_pass(None).await });

    tokio::time::timeout(std::time::Duration::from_secs(20), reached_rx)
        .await
        .expect("retention reached seam")
        .expect("retention seam sender retained");

    // In the stale-snapshot window: a fresh session appears and a workflow binds
    // control, then that run is driven TERMINAL.
    let session_id = fixture.insert_session(&candidate.id);
    let control = fixture.control_service();
    let run_id = uuid::Uuid::new_v4().to_string();
    control
        .accept(&run_id, fixture.domain_input(&candidate.id))
        .expect("accept controller run");
    assert!(control.begin_run(&run_id).expect("begin_run"));
    assert!(control
        .bind_session(&run_id, &session_id)
        .expect("bind controller session"));
    control
        .fail_nonterminal(
            &run_id,
            crate::domains::workflows::model::WorkflowRunFailureCode::SessionTurnFailed,
        )
        .expect("terminalize controlling run");
    assert!(
        !control.run_in_flight(&run_id).expect("run_in_flight"),
        "controlling run must be durably terminal before retention re-checks"
    );

    resume_tx.send(()).expect("resume retention");
    let result = tokio::time::timeout(std::time::Duration::from_secs(20), pass)
        .await
        .expect("retention join timeout")
        .expect("retention join")
        .expect("run retention pass");

    let row = result
        .rows
        .iter()
        .find(|row| row.workspace_id == candidate.id)
        .unwrap_or_else(|| panic!("candidate not in retention rows: {:?}", result.rows));
    assert_eq!(
        row.outcome,
        WorktreeRetentionRowOutcome::Blocked,
        "retention must skip the candidate whose session appeared after the snapshot, got {row:?}"
    );
    assert_eq!(result.retired_count, 0, "nothing may be retired");

    let reloaded = fixture
        .state
        .workspace_runtime
        .get_workspace(&candidate.id)
        .expect("get workspace")
        .expect("workspace present");
    assert_eq!(
        reloaded.lifecycle_state,
        WorkspaceLifecycleState::Active,
        "retention must not retire the workspace holding an unadmitted session"
    );
    assert!(
        Path::new(&reloaded.path).exists(),
        "retention must not dematerialize the unadmitted session's workspace"
    );
    assert!(
        fixture
            .state
            .session_service
            .store()
            .find_by_id(&session_id)
            .expect("find session")
            .is_some(),
        "retention must not delete the unadmitted session"
    );

    retention_barriers::clear(&candidate.id);
}

/// Heavy fixture for the real-retention proofs: an `AppState` whose managed
/// worktrees root is a temp dir (via `ANYHARNESS_WORKTREES_ROOT`), a source git
/// repo to spawn worktrees from, and helpers to materialize the retention
/// candidate + seed keepers past the policy minimum.
struct RetentionFixture {
    state: AppState,
    source_repo: PathBuf,
    managed_root: PathBuf,
    _root_guard: TempDirGuard,
}

struct MaterializedCandidate {
    id: String,
    repo_root_id: String,
}

impl RetentionFixture {
    fn new(tag: &str) -> Self {
        // The managed worktrees root defaults to `runtime_home.parent()/worktrees`
        // when ANYHARNESS_WORKTREES_ROOT is unset — so a temp `<root>/runtime`
        // runtime home yields `<root>/worktrees` WITHOUT touching the
        // process-global env var (which would race sibling tests).
        let root = TempDirGuard::new(tag);
        let runtime_home = root.path().join("runtime");
        let managed_root = root.path().join("worktrees");
        let source_repo = root.path().join("source");
        std::fs::create_dir_all(&runtime_home).expect("runtime home");
        std::fs::create_dir_all(&managed_root).expect("managed root");
        std::fs::create_dir_all(&source_repo).expect("source repo");
        init_source_repo(&source_repo);

        // Canonicalize to match run_pass's canonical_managed_worktrees_root.
        let managed_root =
            canonical_managed_worktrees_root(&runtime_home).expect("canonical managed root");

        let state = AppState::new(
            runtime_home,
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state");

        Self {
            state,
            source_repo,
            managed_root,
            _root_guard: root,
        }
    }

    /// Create a REAL git worktree under the managed root and register it as an
    /// active standard worktree workspace — the retention candidate.
    fn materialize_candidate(&self) -> MaterializedCandidate {
        let source = self.source_repo.to_string_lossy().to_string();
        let resolution = self
            .state
            .workspace_runtime
            .create_workspace(&source)
            .expect("register source repo root");
        let repo_root_id = resolution.repo_root.id.clone();
        let target = self.managed_root.join("candidate");
        let result = self
            .state
            .workspace_runtime
            .create_worktree(
                &repo_root_id,
                &target.to_string_lossy(),
                "feature/retention-candidate",
                Some("main"),
                None,
            )
            .expect("create candidate worktree");
        MaterializedCandidate {
            id: result.workspace.id,
            repo_root_id,
        }
    }

    /// Seed `count` keeper worktree workspaces (real dirs under the managed root
    /// so they survive the listing filter) to push the candidate past the
    /// policy's per-repo keep threshold. Keepers are only ever kept, never
    /// retired, so plain directories suffice.
    fn seed_keepers(&self, repo_root_id: &str, count: usize) {
        // The default policy keeps 20 per repo; lower it to the minimum so
        // `count` keepers + the candidate push the candidate into the eligible
        // tail without seeding 20+ real directories.
        self.state
            .workspace_retention_service
            .update_policy(count as u32)
            .expect("lower retention keep threshold");
        for index in 0..count {
            let id = format!("keeper-{index}-{}", uuid::Uuid::new_v4());
            let path = self.managed_root.join(&id);
            std::fs::create_dir_all(&path).expect("keeper dir");
            // Keepers get NEWER activity than the candidate so ordering places
            // them ahead of it (candidate falls into the eligible tail).
            let created_at = format!("2030-01-01T00:00:{:02}Z", index + 1);
            self.state
                .db
                .with_conn(|conn| {
                    conn.execute(
                        "INSERT INTO workspaces (
                            id, kind, repo_root_id, path, surface, lifecycle_state, cleanup_state,
                            created_at, updated_at
                         ) VALUES (?1, 'worktree', ?2, ?3, 'standard', 'active', 'none', ?4, ?4)",
                        rusqlite::params![id, repo_root_id, path.to_string_lossy(), created_at],
                    )?;
                    Ok(())
                })
                .expect("insert keeper workspace");
        }
    }

    fn insert_session(&self, workspace_id: &str) -> String {
        let now = chrono::Utc::now().to_rfc3339();
        let record = SessionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            // Idle status + no live handle: the dead-actor state the preflight
            // cannot see as a blocker.
            status: "idle".to_string(),
            created_at: now.clone(),
            updated_at: now,
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InternalOnly,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: Some(crate::origin::OriginContext::system_local_runtime()),
        };
        self.state
            .session_service
            .store()
            .insert(&record)
            .expect("insert session row");
        record.id
    }

    fn control_service(&self) -> std::sync::Arc<WorkflowRunService> {
        std::sync::Arc::new(WorkflowRunService::new(WorkflowRunStore::new(
            self.state.db.clone(),
        )))
    }

    fn domain_input(
        &self,
        workspace_id: &str,
    ) -> crate::domains::workflows::model::PutWorkflowRunInput {
        use crate::domains::workflows::model::{
            PutWorkflowRunInput, WorkflowDefinition, WorkflowHarnessConfig, WorkflowInput,
            WorkflowInputType, WorkflowPromptStep, WorkflowStage,
        };
        let mut arguments = std::collections::BTreeMap::new();
        arguments.insert("ticket".to_string(), serde_json::json!("PROL-123"));
        PutWorkflowRunInput {
            schema_version: 1,
            workspace_id: workspace_id.to_string(),
            definition: WorkflowDefinition {
                inputs: vec![WorkflowInput {
                    name: "ticket".to_string(),
                    input_type: WorkflowInputType::String,
                    required: true,
                }],
                stages: vec![WorkflowStage {
                    harness_config: WorkflowHarnessConfig {
                        agent_kind: "claude".to_string(),
                        model_id: None,
                        mode_id: None,
                    },
                    steps: vec![WorkflowPromptStep {
                        kind: "agent.prompt".to_string(),
                        prompt: "Investigate {{inputs.ticket}}".to_string(),
                    }],
                }],
            },
            arguments,
        }
    }
}

fn init_source_repo(path: &Path) {
    run_git(path, &["init", "-b", "main"]);
    run_git(path, &["config", "user.email", "codex@example.com"]);
    run_git(path, &["config", "user.name", "Codex"]);
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    run_git(path, &["add", "README.md"]);
    run_git(path, &["commit", "-m", "Initial commit"]);
}

fn run_git(cwd: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn workspace_record(id: &str) -> WorkspaceRecord {
    WorkspaceRecord {
        id: id.to_string(),
        kind: WorkspaceKind::Worktree,
        repo_root_id: "repo-root-1".to_string(),
        path: format!("/tmp/{id}"),
        surface: WorkspaceSurface::Standard,
        original_branch: Some("main".to_string()),
        current_branch: Some("main".to_string()),
        display_name: None,
        origin: None,
        creator_context: None,
        lifecycle_state: WorkspaceLifecycleState::Active,
        cleanup_state: WorkspaceCleanupState::None,
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
    }
}
