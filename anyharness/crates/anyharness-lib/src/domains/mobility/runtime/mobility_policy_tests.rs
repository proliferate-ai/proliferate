//! Hand-built-facts tests for `mobility_policy`. No DB, no live handles, no
//! clock — every fact is written out in the test body, the same shape as
//! `domains/sessions/runtime/launch_policy.rs`'s suite.

use super::mobility_policy::{
    archive_size_blocker, assess_mobility_preflight, classify_session_support, movable_session_ids,
    plan_source_destruction, terminal_status_is_active, workspace_can_move, DefaultBranchFact,
    MaterializationDestruction, PreflightFacts, PreflightGitStatus, PreflightSessionFacts,
    SourceDestructionFacts, SourceDestructionRejection, TerminalFact,
};
use crate::domains::mobility::model::{MobilityBlocker, MAX_MOBILITY_ARCHIVE_BODY_BYTES};
use crate::domains::terminals::model::TerminalStatus;
use crate::domains::workspaces::access_model::WorkspaceAccessMode;
use crate::domains::workspaces::model::WorkspaceKind;

// --- fact builders ---------------------------------------------------------

/// A movable worktree workspace: nothing blocks, nothing warns.
fn clean_preflight_facts() -> PreflightFacts {
    PreflightFacts {
        workspace_kind: WorkspaceKind::Worktree,
        runtime_mode: WorkspaceAccessMode::Normal,
        branch_name: Some("feature/move-me".to_string()),
        default_branch: DefaultBranchFact::NotRequired,
        setup_running: false,
        git_status: PreflightGitStatus::Inspected {
            detached: false,
            operation_in_progress: false,
            conflicted: false,
            clean: true,
        },
        active_terminal_ids: Vec::new(),
        sessions: Vec::new(),
        partial_subagent_graph_session_ids: Vec::new(),
    }
}

fn idle_session(session_id: &str) -> PreflightSessionFacts {
    PreflightSessionFacts {
        session_id: session_id.to_string(),
        status: "idle".to_string(),
        agent_kind: "claude".to_string(),
        supported: true,
        unsupported_reason: None,
        awaiting_interaction: false,
        has_pending_prompts: false,
    }
}

fn codes(blockers: &[MobilityBlocker]) -> Vec<&str> {
    blockers
        .iter()
        .map(|blocker| blocker.code.as_str())
        .collect()
}

// --- terminal activity -----------------------------------------------------

#[test]
fn only_starting_and_running_terminals_are_active() {
    assert!(terminal_status_is_active(&TerminalStatus::Starting));
    assert!(terminal_status_is_active(&TerminalStatus::Running));
    assert!(!terminal_status_is_active(&TerminalStatus::Exited));
    assert!(!terminal_status_is_active(&TerminalStatus::Failed));
}

// --- session support -------------------------------------------------------

#[test]
fn supported_agent_kinds_carry_no_reason() {
    for kind in ["claude", "codex"] {
        let support = classify_session_support(kind);
        assert!(support.supported, "{kind} should be supported");
        assert!(support.reason.is_none());
    }
}

#[test]
fn unsupported_agent_kind_carries_the_v1_reason() {
    let support = classify_session_support("cursor");

    assert!(!support.supported);
    assert_eq!(
        support.reason.as_deref(),
        Some("Unsupported agent kind for workspace mobility v1")
    );
}

#[test]
fn only_supported_sessions_are_movable() {
    let mut unsupported = idle_session("session-2");
    unsupported.supported = false;
    let sessions = vec![idle_session("session-1"), unsupported];

    assert_eq!(
        movable_session_ids(&sessions),
        vec!["session-1".to_string()]
    );
}

// --- can_move / archive size ----------------------------------------------

#[test]
fn can_move_only_with_no_blockers() {
    assert!(workspace_can_move(&[]));
    assert!(!workspace_can_move(&[MobilityBlocker {
        code: "workspace_dirty".to_string(),
        message: "dirty".to_string(),
        session_id: None,
    }]));
}

#[test]
fn archive_size_blocks_only_above_the_limit() {
    assert!(archive_size_blocker(0).is_none());
    assert!(archive_size_blocker(MAX_MOBILITY_ARCHIVE_BODY_BYTES as u64).is_none());

    let blocker = archive_size_blocker(MAX_MOBILITY_ARCHIVE_BODY_BYTES as u64 + 1)
        .expect("one byte over the limit blocks");
    assert_eq!(blocker.code, "archive_too_large");
    assert_eq!(blocker.session_id, None);
}

// --- preflight assessment --------------------------------------------------

#[test]
fn clean_worktree_workspace_has_no_blockers_or_warnings() {
    let assessment = assess_mobility_preflight(&clean_preflight_facts());

    assert_eq!(codes(&assessment.blockers), Vec::<&str>::new());
    assert!(assessment.warnings.is_empty());
    assert!(workspace_can_move(&assessment.blockers));
}

#[test]
fn non_normal_runtime_mode_blocks_the_move() {
    let mut facts = clean_preflight_facts();
    facts.runtime_mode = WorkspaceAccessMode::FrozenForHandoff;

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), vec!["workspace_not_mutable"]);
    assert_eq!(
        assessment.blockers[0].message,
        "Workspace is currently in frozen_for_handoff mode"
    );
}

#[test]
fn unresolved_local_default_branch_blocks_the_move() {
    let mut facts = clean_preflight_facts();
    facts.workspace_kind = WorkspaceKind::Local;
    facts.default_branch = DefaultBranchFact::Unresolved;

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), vec!["default_branch_unknown"]);
}

#[test]
fn local_workspace_sitting_on_the_default_branch_blocks_the_move() {
    let mut facts = clean_preflight_facts();
    facts.workspace_kind = WorkspaceKind::Local;
    facts.branch_name = Some("main".to_string());
    facts.default_branch = DefaultBranchFact::Resolved("main".to_string());

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(
        codes(&assessment.blockers),
        vec!["local_default_branch_in_use"]
    );
    assert_eq!(
        assessment.blockers[0].message,
        "Main local workspaces on 'main' must move from a worktree instead"
    );
}

#[test]
fn local_workspace_on_a_side_branch_is_movable() {
    let mut facts = clean_preflight_facts();
    facts.workspace_kind = WorkspaceKind::Local;
    facts.branch_name = Some("feature/side".to_string());
    facts.default_branch = DefaultBranchFact::Resolved("main".to_string());

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), Vec::<&str>::new());
}

#[test]
fn a_worktree_on_the_repo_default_branch_name_is_not_blocked() {
    // The default-branch-in-use rule is Local-only: a worktree that happens to
    // sit on a branch named like the default still moves.
    let mut facts = clean_preflight_facts();
    facts.branch_name = Some("main".to_string());
    facts.default_branch = DefaultBranchFact::Resolved("main".to_string());

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), Vec::<&str>::new());
}

#[test]
fn running_setup_blocks_the_move() {
    let mut facts = clean_preflight_facts();
    facts.setup_running = true;

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), vec!["setup_running"]);
}

#[test]
fn every_dirty_git_condition_raises_its_own_blocker_in_order() {
    let mut facts = clean_preflight_facts();
    facts.git_status = PreflightGitStatus::Inspected {
        detached: true,
        operation_in_progress: true,
        conflicted: true,
        clean: false,
    };

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(
        codes(&assessment.blockers),
        vec![
            "workspace_detached",
            "git_operation_in_progress",
            "workspace_conflicted",
            "workspace_dirty",
        ]
    );
}

#[test]
fn unavailable_git_status_blocks_with_the_inspection_error() {
    let mut facts = clean_preflight_facts();
    facts.git_status = PreflightGitStatus::Unavailable {
        error: "not a git repository".to_string(),
    };

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(
        codes(&assessment.blockers),
        vec!["workspace_status_unknown"]
    );
    assert_eq!(
        assessment.blockers[0].message,
        "Unable to inspect workspace status: not a git repository"
    );
}

#[test]
fn active_terminals_warn_but_never_block() {
    let mut facts = clean_preflight_facts();
    facts.active_terminal_ids = vec!["terminal-1".to_string(), "terminal-2".to_string()];

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), Vec::<&str>::new());
    assert_eq!(
        assessment.warnings,
        vec![
            "Terminal terminal-1 will be force-closed after the move commits".to_string(),
            "Terminal terminal-2 will be force-closed after the move commits".to_string(),
        ]
    );
    assert!(workspace_can_move(&assessment.blockers));
}

#[test]
fn starting_and_running_sessions_block_the_move() {
    for status in ["starting", "running"] {
        let mut facts = clean_preflight_facts();
        let mut session = idle_session("session-1");
        session.status = status.to_string();
        facts.sessions = vec![session];

        let assessment = assess_mobility_preflight(&facts);

        assert_eq!(
            codes(&assessment.blockers),
            vec!["session_running"],
            "status {status} should block"
        );
        assert_eq!(
            assessment.blockers[0].session_id.as_deref(),
            Some("session-1")
        );
    }
}

#[test]
fn per_session_blockers_stack_in_a_fixed_order() {
    let mut facts = clean_preflight_facts();
    facts.sessions = vec![PreflightSessionFacts {
        session_id: "session-1".to_string(),
        status: "running".to_string(),
        agent_kind: "cursor".to_string(),
        supported: false,
        unsupported_reason: Some("Unsupported agent kind for workspace mobility v1".to_string()),
        awaiting_interaction: true,
        has_pending_prompts: true,
    }];

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(
        codes(&assessment.blockers),
        vec![
            "session_running",
            "session_awaiting_interaction",
            "pending_prompt",
            "unsupported_session",
        ]
    );
    assert_eq!(
        assessment.blockers[3].message,
        "Session session-1 (cursor) cannot move because Unsupported agent kind for workspace mobility v1"
    );
}

#[test]
fn an_unsupported_session_without_a_reason_falls_back_to_generic_text() {
    let mut facts = clean_preflight_facts();
    let mut session = idle_session("session-1");
    session.agent_kind = "cursor".to_string();
    session.supported = false;
    session.unsupported_reason = None;
    facts.sessions = vec![session];

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), vec!["unsupported_session"]);
    assert_eq!(
        assessment.blockers[0].message,
        "Session session-1 (cursor) cannot move because it is unsupported"
    );
}

#[test]
fn a_partial_subagent_graph_blocks_per_missing_session() {
    let mut facts = clean_preflight_facts();
    facts.partial_subagent_graph_session_ids = vec!["child-1".to_string()];

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(codes(&assessment.blockers), vec!["partial_subagent_graph"]);
    assert_eq!(
        assessment.blockers[0].session_id.as_deref(),
        Some("child-1")
    );
    assert_eq!(
        assessment.blockers[0].message,
        "Session graph includes linked subagent session child-1 outside this archive"
    );
}

#[test]
fn blocker_order_is_workspace_then_session_then_graph() {
    // The whole matrix at once: the emitted order is user-visible (it is
    // serialized straight to the API), so it is pinned here.
    let mut facts = clean_preflight_facts();
    facts.workspace_kind = WorkspaceKind::Local;
    facts.runtime_mode = WorkspaceAccessMode::RemoteOwned;
    facts.branch_name = Some("main".to_string());
    facts.default_branch = DefaultBranchFact::Resolved("main".to_string());
    facts.setup_running = true;
    facts.git_status = PreflightGitStatus::Inspected {
        detached: false,
        operation_in_progress: false,
        conflicted: false,
        clean: false,
    };
    facts.active_terminal_ids = vec!["terminal-1".to_string()];
    let mut session = idle_session("session-1");
    session.status = "running".to_string();
    facts.sessions = vec![session];
    facts.partial_subagent_graph_session_ids = vec!["child-1".to_string()];

    let assessment = assess_mobility_preflight(&facts);

    assert_eq!(
        codes(&assessment.blockers),
        vec![
            "workspace_not_mutable",
            "setup_running",
            "workspace_dirty",
            "local_default_branch_in_use",
            "session_running",
            "partial_subagent_graph",
        ]
    );
    assert_eq!(assessment.warnings.len(), 1);
}

// --- destroy source --------------------------------------------------------

#[test]
fn worktree_destruction_closes_active_terminals_and_deletes_every_session() {
    let facts = SourceDestructionFacts {
        workspace_kind: WorkspaceKind::Worktree,
        default_branch: DefaultBranchFact::NotRequired,
        terminals: vec![
            TerminalFact {
                terminal_id: "terminal-running".to_string(),
                status: TerminalStatus::Running,
            },
            TerminalFact {
                terminal_id: "terminal-exited".to_string(),
                status: TerminalStatus::Exited,
            },
            TerminalFact {
                terminal_id: "terminal-starting".to_string(),
                status: TerminalStatus::Starting,
            },
        ],
        session_ids: vec!["session-1".to_string(), "session-2".to_string()],
    };

    let plan = plan_source_destruction(&facts).expect("worktree destruction needs no branch");

    assert_eq!(
        plan.close_terminal_ids,
        vec![
            "terminal-running".to_string(),
            "terminal-starting".to_string()
        ]
    );
    assert_eq!(
        plan.delete_session_ids,
        vec!["session-1".to_string(), "session-2".to_string()]
    );
    assert!(matches!(
        plan.materialization,
        MaterializationDestruction::RemoveWorktree
    ));
    assert_eq!(plan.materialization.default_branch(), None);
}

#[test]
fn local_destruction_parks_onto_the_resolved_default_branch() {
    let facts = SourceDestructionFacts {
        workspace_kind: WorkspaceKind::Local,
        default_branch: DefaultBranchFact::Resolved("main".to_string()),
        terminals: Vec::new(),
        session_ids: Vec::new(),
    };

    let plan = plan_source_destruction(&facts).expect("resolved branch parks");

    assert!(matches!(
        plan.materialization,
        MaterializationDestruction::ParkLocalOnDefaultBranch { .. }
    ));
    assert_eq!(plan.materialization.default_branch(), Some("main"));
}

#[test]
fn local_destruction_is_rejected_before_any_effect_without_a_default_branch() {
    // The pre-restructure order discovered this only after the terminals were
    // closed and every session deleted. Now it is a precondition on the plan.
    for default_branch in [
        DefaultBranchFact::Unresolved,
        DefaultBranchFact::NotRequired,
        DefaultBranchFact::Resolved("   ".to_string()),
    ] {
        let facts = SourceDestructionFacts {
            workspace_kind: WorkspaceKind::Local,
            default_branch,
            terminals: vec![TerminalFact {
                terminal_id: "terminal-1".to_string(),
                status: TerminalStatus::Running,
            }],
            session_ids: vec!["session-1".to_string()],
        };

        let rejection =
            plan_source_destruction(&facts).expect_err("a local park needs a default branch");

        assert_eq!(
            rejection,
            SourceDestructionRejection::MissingLocalDefaultBranch
        );
    }
}

#[test]
fn destruction_of_an_empty_workspace_is_an_empty_plan_not_an_error() {
    let facts = SourceDestructionFacts {
        workspace_kind: WorkspaceKind::Worktree,
        default_branch: DefaultBranchFact::NotRequired,
        terminals: Vec::new(),
        session_ids: Vec::new(),
    };

    let plan = plan_source_destruction(&facts).expect("empty workspace still destroys");

    assert!(plan.close_terminal_ids.is_empty());
    assert!(plan.delete_session_ids.is_empty());
}
