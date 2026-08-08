//! Pure mobility decisions for the mobility runtime.
//!
//! Everything here is data-in / data-out: no store, no clock, no uuid, no
//! `&self`. `preflight.rs` and `destroy_source.rs` perform the resolve steps
//! (workspace/session/terminal loads, git inspection, live probes) and hand the
//! gathered facts in; this module owns the decisions — which terminals count as
//! active, which sessions mobility v1 can carry, what blocks a move, and what
//! the destroy-source effect sequence is.
//!
//! Two shapes appear per use case: a `*Facts` struct the IO layer fills in, and
//! a decision (a plan, an assessment, or a predicate) the IO layer executes.
//! Plans carry ids only — the records and the capabilities they name travel
//! beside the plan, never inside it.

use crate::domains::mobility::model::{MobilityBlocker, MAX_MOBILITY_ARCHIVE_BODY_BYTES};
use crate::domains::mobility::service::is_supported_agent_kind;
use crate::domains::terminals::model::{TerminalRecord, TerminalStatus};
use crate::domains::workspaces::access_model::WorkspaceAccessMode;
use crate::domains::workspaces::model::WorkspaceKind;

/// A terminal is "active" for mobility purposes while it still owns a process:
/// starting or running. Exited and failed terminals need no force-close and
/// raise no warning. Single home for the rule — `runtime/mod.rs` filters live
/// records with [`terminal_is_active`], `destroy_source.rs` decides over
/// [`TerminalFact`]s.
pub(super) fn terminal_status_is_active(status: &TerminalStatus) -> bool {
    matches!(status, TerminalStatus::Starting | TerminalStatus::Running)
}

/// [`terminal_status_is_active`] over a whole live record, for the runtime's
/// gather helpers.
pub(super) fn terminal_is_active(terminal: &TerminalRecord) -> bool {
    terminal_status_is_active(&terminal.status)
}

/// Whether mobility v1 can carry a session of this agent kind, and the reason
/// text shown when it cannot. The support predicate itself stays in
/// `service.rs` — it also gates which sessions enter the durable export bundle,
/// so there is exactly one answer for both paths; this fn owns the surfaced
/// reason.
pub(super) fn classify_session_support(agent_kind: &str) -> SessionSupport {
    if is_supported_agent_kind(agent_kind) {
        return SessionSupport {
            supported: true,
            reason: None,
        };
    }
    SessionSupport {
        supported: false,
        reason: Some("Unsupported agent kind for workspace mobility v1".to_string()),
    }
}

pub(super) struct SessionSupport {
    pub supported: bool,
    pub reason: Option<String>,
}

/// Whether the workspace can move: no blockers, nothing else. One rule with two
/// consumers — it gates the (expensive) archive size estimate and it is the
/// `can_move` field of the preflight result.
pub(super) fn workspace_can_move(blockers: &[MobilityBlocker]) -> bool {
    blockers.is_empty()
}

/// The archive-size limit, decided over an already-measured estimate.
pub(super) fn archive_size_blocker(estimated_bytes: u64) -> Option<MobilityBlocker> {
    if estimated_bytes <= MAX_MOBILITY_ARCHIVE_BODY_BYTES as u64 {
        return None;
    }
    Some(MobilityBlocker {
        code: "archive_too_large".to_string(),
        message: format!(
            "Archive exceeds the {} byte limit",
            MAX_MOBILITY_ARCHIVE_BODY_BYTES
        ),
        session_id: None,
    })
}

// ---------------------------------------------------------------------------
// Preflight: can this workspace move right now?
// ---------------------------------------------------------------------------

/// Whether the repo's default branch was needed and resolved. Only `Local`
/// workspaces need one (they park onto it); worktrees are removed outright.
pub(super) enum DefaultBranchFact {
    /// Not a `Local` workspace — no default branch is involved.
    NotRequired,
    Resolved(String),
    /// Required but the resolver failed.
    Unresolved,
}

/// Git inspection result. A failed inspection is a fact, not an error: preflight
/// reports it as a blocker instead of aborting.
pub(super) enum PreflightGitStatus {
    Inspected {
        detached: bool,
        operation_in_progress: bool,
        conflicted: bool,
        clean: bool,
    },
    Unavailable {
        error: String,
    },
}

/// One session's resolved facts. `supported`/`reason` come from
/// [`classify_session_support`]; the rest are store and live reads.
pub(super) struct PreflightSessionFacts {
    pub session_id: String,
    pub status: String,
    pub agent_kind: String,
    pub supported: bool,
    pub unsupported_reason: Option<String>,
    pub awaiting_interaction: bool,
    pub has_pending_prompts: bool,
}

/// Every fact the preflight assessment branches on, gathered by `preflight.rs`
/// in a single resolve pass before any decision is made.
pub(super) struct PreflightFacts {
    pub workspace_kind: WorkspaceKind,
    pub runtime_mode: WorkspaceAccessMode,
    pub branch_name: Option<String>,
    pub default_branch: DefaultBranchFact,
    pub setup_running: bool,
    pub git_status: PreflightGitStatus,
    pub active_terminal_ids: Vec<String>,
    pub sessions: Vec<PreflightSessionFacts>,
    /// Linked subagent sessions that sit outside the moving set.
    pub partial_subagent_graph_session_ids: Vec<String>,
}

pub(super) struct PreflightAssessment {
    pub blockers: Vec<MobilityBlocker>,
    pub warnings: Vec<String>,
}

/// The whole preflight blocker/warning matrix, in the order the API surfaces it.
///
/// Blocker order is user-visible (it is serialized straight through), so the
/// sequence below is deliberate and matches the pre-extraction interleaved
/// pipeline exactly: workspace-level rules first (mutability, default branch,
/// setup, git state, default-branch-in-use), then per-terminal warnings, then
/// per-session rules, then the subagent graph. The
/// archive-size blocker is appended later by the caller, after the estimate is
/// resolved — see [`archive_size_blocker`].
pub(super) fn assess_mobility_preflight(facts: &PreflightFacts) -> PreflightAssessment {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    if facts.runtime_mode != WorkspaceAccessMode::Normal {
        blockers.push(MobilityBlocker {
            code: "workspace_not_mutable".to_string(),
            message: format!(
                "Workspace is currently in {} mode",
                facts.runtime_mode.as_str()
            ),
            session_id: None,
        });
    }

    if matches!(facts.default_branch, DefaultBranchFact::Unresolved) {
        blockers.push(MobilityBlocker {
            code: "default_branch_unknown".to_string(),
            message: ("Main local workspaces require a resolved repo default branch ".to_string()),
            session_id: None,
        });
    }

    if facts.setup_running {
        blockers.push(MobilityBlocker {
            code: "setup_running".to_string(),
            message: "Workspace setup is still running".to_string(),
            session_id: None,
        });
    }

    match &facts.git_status {
        PreflightGitStatus::Inspected {
            detached,
            operation_in_progress,
            conflicted,
            clean,
        } => {
            if *detached {
                blockers.push(MobilityBlocker {
                    code: "workspace_detached".to_string(),
                    message: "Workspace must be on a branch before moving".to_string(),
                    session_id: None,
                });
            }
            if *operation_in_progress {
                blockers.push(MobilityBlocker {
                    code: "git_operation_in_progress".to_string(),
                    message: "Finish the current Git operation before moving".to_string(),
                    session_id: None,
                });
            }
            if *conflicted {
                blockers.push(MobilityBlocker {
                    code: "workspace_conflicted".to_string(),
                    message: "Resolve Git conflicts before moving".to_string(),
                    session_id: None,
                });
            }
            if !*clean {
                blockers.push(MobilityBlocker {
                    code: "workspace_dirty".to_string(),
                    message: "Workspace must be committed and clean before moving".to_string(),
                    session_id: None,
                });
            }
        }
        PreflightGitStatus::Unavailable { error } => blockers.push(MobilityBlocker {
            code: "workspace_status_unknown".to_string(),
            message: format!("Unable to inspect workspace status: {error}"),
            session_id: None,
        }),
    }

    if facts.workspace_kind == WorkspaceKind::Local {
        if let (Some(current_branch), DefaultBranchFact::Resolved(default_branch)) =
            (facts.branch_name.as_deref(), &facts.default_branch)
        {
            if current_branch == default_branch {
                blockers.push(MobilityBlocker {
                    code: "local_default_branch_in_use".to_string(),
                    message: format!(
                        "Main local workspaces on '{default_branch}' must move from a worktree instead"
                    ),
                    session_id: None,
                });
            }
        }
    }

    for terminal_id in &facts.active_terminal_ids {
        warnings.push(format!(
            "Terminal {terminal_id} will be force-closed after the move commits"
        ));
    }

    for session in &facts.sessions {
        if matches!(session.status.as_str(), "starting" | "running") {
            blockers.push(MobilityBlocker {
                code: "session_running".to_string(),
                message: format!("Session {} is still active", session.session_id),
                session_id: Some(session.session_id.clone()),
            });
        }

        if session.awaiting_interaction {
            blockers.push(MobilityBlocker {
                code: "session_awaiting_interaction".to_string(),
                message: format!("Session {} is awaiting interaction", session.session_id),
                session_id: Some(session.session_id.clone()),
            });
        }

        if session.has_pending_prompts {
            blockers.push(MobilityBlocker {
                code: "pending_prompt".to_string(),
                message: format!("Session {} has pending prompts", session.session_id),
                session_id: Some(session.session_id.clone()),
            });
        }

        if !session.supported {
            blockers.push(MobilityBlocker {
                code: "unsupported_session".to_string(),
                message: format!(
                    "Session {} ({}) cannot move because {}",
                    session.session_id,
                    session.agent_kind,
                    session
                        .unsupported_reason
                        .clone()
                        .unwrap_or_else(|| "it is unsupported".to_string())
                ),
                session_id: Some(session.session_id.clone()),
            });
        }
    }

    for missing_id in &facts.partial_subagent_graph_session_ids {
        blockers.push(MobilityBlocker {
            code: "partial_subagent_graph".to_string(),
            message: format!(
                "Session graph includes linked subagent session {missing_id} outside this archive"
            ),
            session_id: Some(missing_id.clone()),
        });
    }

    PreflightAssessment { blockers, warnings }
}

/// The sessions that enter the archive: the supported ones. Deduplicated by the
/// caller into a set for the subagent-graph lookup.
pub(super) fn movable_session_ids(sessions: &[PreflightSessionFacts]) -> Vec<String> {
    sessions
        .iter()
        .filter(|session| session.supported)
        .map(|session| session.session_id.clone())
        .collect()
}

// ---------------------------------------------------------------------------
// Destroy source: tear the old materialization down after a committed move
// ---------------------------------------------------------------------------

pub(super) struct TerminalFact {
    pub terminal_id: String,
    pub status: TerminalStatus,
}

/// Everything destroy-source decides over, resolved in one pass under the
/// caller's exclusive workspace lease.
pub(super) struct SourceDestructionFacts {
    pub workspace_kind: WorkspaceKind,
    /// The repo default branch, resolved for `Local` workspaces only.
    pub default_branch: DefaultBranchFact,
    /// Every live terminal in the workspace, unfiltered.
    pub terminals: Vec<TerminalFact>,
    /// Every session row in the workspace, in store order.
    pub session_ids: Vec<String>,
}

/// How the source materialization goes away. `Local` workspaces park onto the
/// repo default branch; worktrees are removed.
#[derive(Debug)]
pub(super) enum MaterializationDestruction {
    RemoveWorktree,
    ParkLocalOnDefaultBranch { default_branch: String },
}

impl MaterializationDestruction {
    /// The `default_branch` argument
    /// `WorkspaceRuntime::destroy_source_workspace_materialization` expects.
    pub(super) fn default_branch(&self) -> Option<&str> {
        match self {
            Self::RemoveWorktree => None,
            Self::ParkLocalOnDefaultBranch { default_branch } => Some(default_branch.as_str()),
        }
    }
}

/// The destroy-source effect sequence, as pure data. Effects run in field order:
/// close terminals, delete sessions, destroy the materialization.
#[derive(Debug)]
pub(super) struct SourceDestructionPlan {
    pub close_terminal_ids: Vec<String>,
    pub delete_session_ids: Vec<String>,
    pub materialization: MaterializationDestruction,
}

/// A precondition destroy-source cannot satisfy. Returned as data so the caller
/// maps it onto its own error surface.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum SourceDestructionRejection {
    /// A `Local` workspace with no usable repo default branch to park onto.
    MissingLocalDefaultBranch,
}

/// Decide the whole destroy-source sequence from resolved facts.
///
/// The `Local` default-branch precondition is checked here, before any effect
/// runs, rather than being discovered by the materialization call after the
/// terminals are already closed and the sessions already deleted.
pub(super) fn plan_source_destruction(
    facts: &SourceDestructionFacts,
) -> Result<SourceDestructionPlan, SourceDestructionRejection> {
    let materialization = match facts.workspace_kind {
        WorkspaceKind::Worktree => MaterializationDestruction::RemoveWorktree,
        WorkspaceKind::Local => {
            let default_branch = match &facts.default_branch {
                DefaultBranchFact::Resolved(branch) => branch.trim(),
                DefaultBranchFact::NotRequired | DefaultBranchFact::Unresolved => "",
            };
            if default_branch.is_empty() {
                return Err(SourceDestructionRejection::MissingLocalDefaultBranch);
            }
            MaterializationDestruction::ParkLocalOnDefaultBranch {
                default_branch: default_branch.to_string(),
            }
        }
    };

    Ok(SourceDestructionPlan {
        close_terminal_ids: facts
            .terminals
            .iter()
            .filter(|terminal| terminal_status_is_active(&terminal.status))
            .map(|terminal| terminal.terminal_id.clone())
            .collect(),
        delete_session_ids: facts.session_ids.clone(),
        materialization,
    })
}
