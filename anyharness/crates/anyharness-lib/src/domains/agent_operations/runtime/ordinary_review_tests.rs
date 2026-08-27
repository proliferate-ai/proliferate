use super::*;

use std::time::Duration;

use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::route_auth::RouteAuthError;
use crate::domains::sessions::admission::{SessionMutationKind, SessionMutationSource};
use crate::domains::sessions::runtime::{
    CreateAndStartSessionError, CreateOrdinaryAgentSessionError, EnsureLiveSessionError,
    SetSessionConfigOptionError,
};
use crate::domains::workspaces::access_gate::WorkspaceAccessError;
use crate::domains::workspaces::access_model::WorkspaceAccessMode;

#[test]
fn caller_provenance_label_is_unicode_safe_and_bounded() {
    let mut caller = session("caller", "workspace-a", "claude", "model");
    caller.title = Some(format!("  {}  ", "🦀".repeat(300)));
    let label = super::ordinary::caller_provenance_label(&caller);
    assert_eq!(label.chars().count(), 160);
    assert_eq!(label, "🦀".repeat(160));
}

#[tokio::test]
async fn invalid_choices_return_before_workspace_or_session_contention() {
    let fixture = fixture(false);
    let exclusive = fixture
        .workspace_gate
        .acquire_exclusive("workspace-b")
        .await;
    let invalid_launch = tokio::time::timeout(
        Duration::from_millis(250),
        fixture.operations.create_agent(
            &caller(&fixture.operations, "parent"),
            CreateAgentInput {
                workspace: WorkspaceIdentity {
                    runtime_id: RuntimeIdentity::new("runtime-1"),
                    workspace_id: "workspace-b".into(),
                },
                kind: AgentCreationKind::Ordinary,
                task: None,
                agent_kind: Some(fixture.agent_kind.clone()),
                model_id: Some("stale-model".into()),
                control_values: Default::default(),
            },
        ),
    )
    .await
    .expect("launch validation must not wait for workspace lease");
    assert!(matches!(
        invalid_launch,
        Err(AgentOperationsError::LaunchSelection(
            AgentLaunchSelectionError::ModelUnknown
        ))
    ));
    drop(exclusive);

    let permit = fixture
        .session_admission
        .acquire(
            "peer",
            SessionMutationKind::Config,
            &SessionMutationSource::external(),
        )
        .await
        .expect("hold target permit");
    let invalid_config = tokio::time::timeout(
        Duration::from_millis(250),
        fixture.operations.configure_agent(
            &caller(&fixture.operations, "parent"),
            ConfigureAgentInput {
                target: target("peer"),
                config_id: "effort".into(),
                value: "stale".into(),
            },
        ),
    )
    .await
    .expect("config validation must not wait for target permit");
    assert!(matches!(
        invalid_config,
        Err(AgentOperationsError::ConfigChoice(
            AgentConfigChoiceError::ValueUnknown
        ))
    ));
    drop(permit);
    assert!(fixture.mutations.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn execution_time_config_rejection_remains_typed_and_redacted() {
    let fixture = fixture(false);
    *fixture.mutations.config_error.lock().unwrap() = Some(SetSessionConfigOptionError::Rejected(
        "secret-owner-race-detail".into(),
    ));
    let error = fixture
        .operations
        .configure_agent(
            &caller(&fixture.operations, "parent"),
            ConfigureAgentInput {
                target: target("peer"),
                config_id: "effort".into(),
                value: "high".into(),
            },
        )
        .await
        .expect_err("owner revalidates at execution time");
    assert!(matches!(
        &error,
        AgentOperationsError::Configure(SetSessionConfigOptionError::Rejected(_))
    ));
    assert_eq!(error.code(), "SESSION_CONFIG_REJECTED");
    assert!(!error.public_message().contains("secret-owner"));
}

#[test]
fn owner_errors_keep_actionable_codes_and_redact_internal_details() {
    let cases = [
        (
            AgentOperationsError::Create(CreateOrdinaryAgentSessionError::Create(
                CreateAndStartSessionError::WorkspaceDirectoryMissing {
                    path: "/secret/checkout".into(),
                },
            )),
            "WORKSPACE_DIRECTORY_MISSING",
        ),
        (
            AgentOperationsError::Create(CreateOrdinaryAgentSessionError::Create(
                CreateAndStartSessionError::RouteAuth(RouteAuthError::SelectionMissing {
                    harness_kind: "secret-harness".into(),
                    revision: 7,
                    reason: None,
                }),
            )),
            "AGENT_ROUTE_SELECTION_MISSING",
        ),
        (
            AgentOperationsError::Resume(EnsureLiveSessionError::AgentNotReady {
                agent_kind: "secret-agent".into(),
                status: ResolvedAgentStatus::CredentialsRequired,
                detail: Some("secret-readiness".into()),
            }),
            "AGENT_NOT_READY",
        ),
        (
            AgentOperationsError::Resume(EnsureLiveSessionError::RestartRequired(
                "secret-restart".into(),
            )),
            "SESSION_RESTART_REQUIRED",
        ),
        (
            AgentOperationsError::Configure(SetSessionConfigOptionError::Rejected(
                "secret-config".into(),
            )),
            "SESSION_CONFIG_REJECTED",
        ),
        (
            AgentOperationsError::Create(CreateOrdinaryAgentSessionError::Access(
                WorkspaceAccessError::MutationBlocked {
                    workspace_id: "secret-workspace".into(),
                    mode: WorkspaceAccessMode::RemoteOwned,
                },
            )),
            "WORKSPACE_MUTATION_BLOCKED",
        ),
    ];
    for (error, code) in cases {
        assert_eq!(error.code(), code);
        assert!(!error.public_message().contains("secret"));
    }
}

#[tokio::test]
async fn concurrent_resumes_serialize_and_preserve_session_identity() {
    let fixture = fixture(false);
    let operations_a = fixture.operations.clone();
    let operations_b = fixture.operations.clone();
    let first = tokio::spawn(async move {
        operations_a
            .resume_agent(&caller(&operations_a, "parent"), &target("peer"))
            .await
    });
    let second = tokio::spawn(async move {
        operations_b
            .resume_agent(&caller(&operations_b, "parent"), &target("peer"))
            .await
    });
    let (first, second) = tokio::join!(first, second);
    for result in [first.unwrap(), second.unwrap()] {
        let agent = result.expect("resume succeeds");
        assert_eq!(agent.identity.session_id, "peer");
        assert_eq!(
            agent.configuration.model_id.as_deref(),
            Some(fixture.model_id.as_str())
        );
    }
    assert_eq!(
        fixture.mutations.max_active_resumes.load(Ordering::SeqCst),
        1
    );
}
