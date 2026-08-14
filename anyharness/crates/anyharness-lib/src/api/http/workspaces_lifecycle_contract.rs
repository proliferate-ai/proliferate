//! The domain↔wire mapping for archive and unarchive.
//!
//! It exists as its own module because `DOMAIN_CONTRACT_IMPORT` bars domain code
//! from naming `anyharness_contract`: `ArchiveOutcome`, `UnarchiveOutcome`,
//! `SnapshotNotice`, and `UnarchiveNotice` are domain types, and every wire shape
//! they turn into is minted here. That boundary is what let the orchestrator be
//! written without a serialization format in scope, and it is what keeps a casing
//! decision from reaching into the flow.
//!
//! Casing, stated once because two rungs build to it: struct fields are
//! camelCase (`deleteBranch`, `archiveScript`, `rerunSetup`, `setupScript`,
//! `branchStrategy`, `occupantName`, `occupantLifecycle`) and enum VALUES are
//! snake_case (`branch_diverged`, `recreate_at_sha`, `partial_capture_untracked`).
//! The contract structs carry `#[serde(rename_all = "camelCase")]`, so the
//! spelling is the repo's, not this feature's.

use anyharness_contract::v1::{
    ArchiveWorkspaceRequest, ArchiveWorkspaceResponse, UnarchiveWorkspaceRequest,
    UnarchiveWorkspaceResponse, WorkspaceArchiveNotice, WorkspaceArchiveNoticeKind,
    WorkspaceLifecycleFilter, WorkspaceUnarchiveBranchStrategy, WorkspaceUnarchiveNotice,
    WorkspaceUnarchiveNoticeKind, WorkspaceUnarchiveScenario, WorkspaceUnarchiveScenarioBody,
    WorkspaceUnarchiveStrategy,
};

use super::error::ApiError;
use super::workspaces_contract::workspace_to_contract;
use crate::adapters::git::types::SnapshotNotice;
use crate::app::AppState;
use crate::domains::workspaces::archive::types::{
    ArchiveOptions, ArchiveOutcome, BranchStrategy, OccupantLifecycle, UnarchiveNotice,
    UnarchiveOptions, UnarchiveOutcome, UnarchiveScenario, UnarchiveScenarioPayload,
    UnarchiveStrategy,
};
use crate::domains::workspaces::model::WorkspaceLifecycleState;

/// Both knobs are optional on the wire and default to "do nothing extra": a
/// client that omits them gets an archive that keeps the branch and runs no
/// script, which is the conservative reading of a missing field.
pub(super) fn archive_options_from_request(request: ArchiveWorkspaceRequest) -> ArchiveOptions {
    ArchiveOptions {
        delete_branch: request.delete_branch.unwrap_or(false),
        archive_script: request.archive_script,
    }
}

pub(super) fn unarchive_options_from_request(
    request: UnarchiveWorkspaceRequest,
) -> UnarchiveOptions {
    UnarchiveOptions {
        rerun_setup: request.rerun_setup.unwrap_or(false),
        setup_script: request.setup_script,
        overwrite: request.overwrite.unwrap_or(false),
        branch_strategy: request.branch_strategy.map(|strategy| match strategy {
            WorkspaceUnarchiveBranchStrategy::RecreateAtSha => BranchStrategy::RecreateAtSha,
            WorkspaceUnarchiveBranchStrategy::RestoreDetached => BranchStrategy::RestoreDetached,
            WorkspaceUnarchiveBranchStrategy::RestoreBranchTip => BranchStrategy::RestoreBranchTip,
        }),
    }
}

pub(super) async fn archive_outcome_to_contract(
    state: &AppState,
    outcome: ArchiveOutcome,
) -> Result<ArchiveWorkspaceResponse, ApiError> {
    Ok(ArchiveWorkspaceResponse {
        record: workspace_to_contract(state, outcome.record).await?,
        notices: outcome
            .notices
            .into_iter()
            .map(snapshot_notice_to_contract)
            .collect(),
    })
}

pub(super) async fn unarchive_outcome_to_contract(
    state: &AppState,
    outcome: UnarchiveOutcome,
) -> Result<UnarchiveWorkspaceResponse, ApiError> {
    Ok(UnarchiveWorkspaceResponse {
        record: workspace_to_contract(state, outcome.record).await?,
        notices: outcome
            .notices
            .into_iter()
            .map(unarchive_notice_to_contract)
            .collect(),
    })
}

/// Every notice field beyond `kind` is additive-optional, so a client that
/// predates a kind renders the kinds it knows instead of failing to parse the
/// whole envelope.
fn snapshot_notice_to_contract(notice: SnapshotNotice) -> WorkspaceArchiveNotice {
    match notice {
        SnapshotNotice::DirtySubmodule { paths } => WorkspaceArchiveNotice {
            kind: WorkspaceArchiveNoticeKind::DirtySubmodule,
            paths: Some(paths),
            operation: None,
        },
        SnapshotNotice::EmbeddedRepo { paths } => WorkspaceArchiveNotice {
            kind: WorkspaceArchiveNoticeKind::EmbeddedRepo,
            paths: Some(paths),
            operation: None,
        },
        SnapshotNotice::PartialCaptureUntracked { paths } => WorkspaceArchiveNotice {
            kind: WorkspaceArchiveNoticeKind::PartialCaptureUntracked,
            paths: Some(paths),
            operation: None,
        },
        SnapshotNotice::PartialCaptureTracked { paths } => WorkspaceArchiveNotice {
            kind: WorkspaceArchiveNoticeKind::PartialCaptureTracked,
            paths: Some(paths),
            operation: None,
        },
        SnapshotNotice::AbortedGitOperation { operation } => WorkspaceArchiveNotice {
            kind: WorkspaceArchiveNoticeKind::AbortedGitOperation,
            paths: None,
            operation: Some(operation),
        },
    }
}

fn unarchive_notice_to_contract(notice: UnarchiveNotice) -> WorkspaceUnarchiveNotice {
    match notice {
        UnarchiveNotice::NoSnapshot => WorkspaceUnarchiveNotice {
            kind: WorkspaceUnarchiveNoticeKind::NoSnapshot,
            paths: None,
        },
        UnarchiveNotice::HistoryIncomplete => WorkspaceUnarchiveNotice {
            kind: WorkspaceUnarchiveNoticeKind::HistoryIncomplete,
            paths: None,
        },
        UnarchiveNotice::HeadMismatch => WorkspaceUnarchiveNotice {
            kind: WorkspaceUnarchiveNoticeKind::HeadMismatch,
            paths: None,
        },
        UnarchiveNotice::PartialCaptureUntracked { paths } => WorkspaceUnarchiveNotice {
            kind: WorkspaceUnarchiveNoticeKind::PartialCaptureUntracked,
            paths: Some(paths),
        },
        UnarchiveNotice::PartialCaptureTracked { paths } => WorkspaceUnarchiveNotice {
            kind: WorkspaceUnarchiveNoticeKind::PartialCaptureTracked,
            paths: Some(paths),
        },
    }
}

/// The typed 409 body. `strategies` is the server's answer to "what may this
/// user choose here" — the dialog renders from it and never infers, which is why
/// an empty list (a live path claim) is a meaningful value rather than a
/// degenerate one.
pub(super) fn scenario_body_to_contract(
    payload: UnarchiveScenarioPayload,
) -> WorkspaceUnarchiveScenarioBody {
    WorkspaceUnarchiveScenarioBody {
        scenario: match payload.scenario {
            UnarchiveScenario::BranchDiverged => WorkspaceUnarchiveScenario::BranchDiverged,
            UnarchiveScenario::CheckedOutElsewhere => {
                WorkspaceUnarchiveScenario::CheckedOutElsewhere
            }
            UnarchiveScenario::SnapshotLost => WorkspaceUnarchiveScenario::SnapshotLost,
            UnarchiveScenario::PathOccupied => WorkspaceUnarchiveScenario::PathOccupied,
        },
        occupant_name: payload.occupant_name,
        // A string rather than a second enum: the client branches its dialog copy
        // on it, and the two values it can hold are exactly the two lifecycle
        // values the shared `WorkspaceLifecycleState` schema already publishes.
        occupant_lifecycle: payload.occupant_lifecycle.map(|lifecycle| {
            match lifecycle {
                OccupantLifecycle::Active => "active",
                OccupantLifecycle::Archived => "archived",
            }
            .to_string()
        }),
        strategies: payload
            .strategies
            .into_iter()
            .map(|strategy| match strategy {
                UnarchiveStrategy::RecreateAtSha => WorkspaceUnarchiveStrategy::RecreateAtSha,
                UnarchiveStrategy::RestoreDetached => WorkspaceUnarchiveStrategy::RestoreDetached,
                UnarchiveStrategy::RestoreBranchTip => WorkspaceUnarchiveStrategy::RestoreBranchTip,
                UnarchiveStrategy::Overwrite => WorkspaceUnarchiveStrategy::Overwrite,
            })
            .collect(),
    }
}

/// `?lifecycle=` resolves to a lifecycle to filter on, or `None` for `all`. The
/// default is `active`: the sidebar's universe is active workspaces, and the
/// archived list asks for its own page explicitly.
pub(super) fn lifecycle_filter_to_domain(
    filter: WorkspaceLifecycleFilter,
) -> Option<WorkspaceLifecycleState> {
    match filter {
        WorkspaceLifecycleFilter::Active => Some(WorkspaceLifecycleState::Active),
        WorkspaceLifecycleFilter::Archived => Some(WorkspaceLifecycleState::Archived),
        WorkspaceLifecycleFilter::All => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CR-1: multi-word request keys are camelCase on the wire. The two rungs
    /// that meet here (R4 emits, R7 reads) have to agree, so the spelling is
    /// pinned rather than assumed.
    #[test]
    fn request_bodies_deserialize_camel_case_keys() {
        let archive: ArchiveWorkspaceRequest =
            serde_json::from_str(r#"{"deleteBranch":true,"archiveScript":"make clean"}"#)
                .expect("archive body");
        let options = archive_options_from_request(archive);
        assert!(options.delete_branch);
        assert_eq!(options.archive_script.as_deref(), Some("make clean"));

        let unarchive: UnarchiveWorkspaceRequest = serde_json::from_str(
            r#"{"rerunSetup":true,"setupScript":"pnpm i","overwrite":true,"branchStrategy":"recreate_at_sha"}"#,
        )
        .expect("unarchive body");
        let options = unarchive_options_from_request(unarchive);
        assert!(options.rerun_setup);
        assert!(options.overwrite);
        assert_eq!(options.setup_script.as_deref(), Some("pnpm i"));
        assert_eq!(options.branch_strategy, Some(BranchStrategy::RecreateAtSha));
    }

    /// An omitted knob is "do nothing extra", never "guess": a re-POST that
    /// dropped the knobs must not delete a branch nobody asked about.
    #[test]
    fn omitted_knobs_default_to_doing_nothing_extra() {
        let options =
            archive_options_from_request(serde_json::from_str("{}").expect("empty archive body"));
        assert!(!options.delete_branch);
        assert!(options.archive_script.is_none());

        let options = unarchive_options_from_request(
            serde_json::from_str("{}").expect("empty unarchive body"),
        );
        assert!(!options.rerun_setup);
        assert!(!options.overwrite);
        assert!(options.branch_strategy.is_none());
    }

    /// The scenario body's field spelling and its snake_case enum values, both
    /// of which R7's dialog reads.
    #[test]
    fn the_scenario_body_serializes_camel_case_keys_and_snake_case_values() {
        let body = scenario_body_to_contract(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::PathOccupied,
            occupant_name: Some("api rewrite".to_string()),
            occupant_lifecycle: Some(OccupantLifecycle::Archived),
            strategies: vec![UnarchiveStrategy::Overwrite],
        });

        let json = serde_json::to_value(&body).expect("serialize");
        assert_eq!(json["scenario"], "path_occupied");
        assert_eq!(json["occupantName"], "api rewrite");
        assert_eq!(json["occupantLifecycle"], "archived");
        assert_eq!(json["strategies"], serde_json::json!(["overwrite"]));
    }

    /// A live claim offers nothing at all, and the empty list has to survive
    /// serialization as an empty list: a client that saw the key vanish would
    /// have to guess whether the field was unsupported or the answer was "no
    /// options".
    #[test]
    fn a_live_claim_serializes_an_empty_strategy_list() {
        let body = scenario_body_to_contract(UnarchiveScenarioPayload {
            scenario: UnarchiveScenario::PathOccupied,
            occupant_name: Some("live one".to_string()),
            occupant_lifecycle: Some(OccupantLifecycle::Active),
            strategies: Vec::new(),
        });

        let json = serde_json::to_value(&body).expect("serialize");
        assert_eq!(json["strategies"], serde_json::json!([]));
        assert_eq!(json["occupantLifecycle"], "active");
    }

    #[test]
    fn the_default_lifecycle_filter_is_active() {
        assert_eq!(
            lifecycle_filter_to_domain(WorkspaceLifecycleFilter::default()),
            Some(WorkspaceLifecycleState::Active)
        );
        assert_eq!(
            lifecycle_filter_to_domain(WorkspaceLifecycleFilter::Archived),
            Some(WorkspaceLifecycleState::Archived)
        );
        assert_eq!(
            lifecycle_filter_to_domain(WorkspaceLifecycleFilter::All),
            None
        );
    }

    #[test]
    fn notices_carry_their_paths_and_their_operation() {
        let notice = snapshot_notice_to_contract(SnapshotNotice::PartialCaptureUntracked {
            paths: vec!["big.bin".to_string()],
        });
        let json = serde_json::to_value(&notice).expect("serialize");
        assert_eq!(json["kind"], "partial_capture_untracked");
        assert_eq!(json["paths"], serde_json::json!(["big.bin"]));

        let notice = snapshot_notice_to_contract(SnapshotNotice::AbortedGitOperation {
            operation: "rebase".to_string(),
        });
        let json = serde_json::to_value(&notice).expect("serialize");
        assert_eq!(json["kind"], "aborted_git_operation");
        assert_eq!(json["operation"], "rebase");
        assert!(json.get("paths").is_none());
    }
}
