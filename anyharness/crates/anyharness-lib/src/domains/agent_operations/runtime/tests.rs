use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;

use super::*;
use crate::domains::sessions::links::model::{SessionLinkRelation, SessionLinkWorkspaceRelation};
use crate::domains::sessions::model::SessionMcpBindingPolicy;

#[derive(Default)]
struct FakeSessions {
    records: Vec<SessionRecord>,
}

impl AgentSessionReads for FakeSessions {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        Ok(self
            .records
            .iter()
            .find(|record| record.id == session_id)
            .cloned())
    }

    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>> {
        Ok(self.records.clone())
    }
}

#[derive(Default)]
struct FakeRelationships {
    links: Vec<SessionLinkRecord>,
}

impl SubagentRelationshipReads for FakeRelationships {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        Ok(self
            .links
            .iter()
            .find(|link| link.child_session_id == child_session_id)
            .cloned())
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        Ok(self
            .links
            .iter()
            .filter(|link| link.parent_session_id == parent_session_id)
            .cloned()
            .collect())
    }
}

#[derive(Default)]
struct FakeExecution {
    states: HashMap<String, SessionExecutionState>,
}

#[async_trait]
impl AgentExecutionReads for FakeExecution {
    async fn execution_state(
        &self,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState> {
        Ok(self
            .states
            .get(&session.id)
            .copied()
            .unwrap_or(SessionExecutionState {
                phase: SessionExecutionStatePhase::Idle,
                has_live_handle: false,
            }))
    }
}

fn session(id: &str, workspace_id: &str, status: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: "codex".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: Some("model-1".to_string()),
        current_model_id: None,
        requested_mode_id: Some("mode-1".to_string()),
        current_mode_id: None,
        title: Some(format!("Agent {id}")),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: status.to_string(),
        created_at: "2026-08-10T00:00:00Z".to_string(),
        updated_at: "2026-08-10T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn link(parent: &str, child: &str, closed: bool) -> SessionLinkRecord {
    SessionLinkRecord {
        id: format!("link-{child}"),
        public_id: Some(format!("subagent-{child}")),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: parent.to_string(),
        child_session_id: child.to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some(format!("Child {child}")),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-10T00:00:00Z".to_string(),
        subagent_closed_at: closed.then(|| "2026-08-10T01:00:00Z".to_string()),
        closed_at: None,
    }
}

fn fixture(closed_c: bool) -> AgentOperations {
    let sessions = FakeSessions {
        records: vec![
            session("P", "workspace-a", "idle"),
            session("Q", "workspace-b", "idle"),
            session("R", "workspace-a", "idle"),
            session("C", "workspace-a", "idle"),
            session("D", "workspace-a", "idle"),
        ],
    };
    let relationships = FakeRelationships {
        links: vec![link("P", "C", closed_c), link("R", "D", false)],
    };
    AgentOperations::new(
        RuntimeIdentity::new("runtime-1"),
        Arc::new(sessions),
        Arc::new(relationships),
        Arc::new(FakeExecution::default()),
    )
}

fn caller(operations: &AgentOperations, id: &str) -> AuthenticatedAgentCaller {
    operations.authenticated_caller(id)
}

fn target(id: &str) -> AgentIdentity {
    AgentIdentity::new(RuntimeIdentity::new("runtime-1"), id)
}

#[tokio::test]
async fn subagent_authorization_matrix_is_runtime_wide_and_parent_scoped() {
    let operations = fixture(false);

    assert_eq!(
        operations
            .get_agent(&caller(&operations, "P"), &target("Q"))
            .await
            .expect("P reads cross-workspace ordinary Q")
            .role,
        AgentRole::Ordinary
    );
    assert_eq!(
        operations
            .get_agent(&caller(&operations, "P"), &target("C"))
            .await
            .expect("P reads owned C")
            .role,
        AgentRole::Subagent
    );
    for unrelated in ["Q", "R"] {
        assert!(matches!(
            operations
                .get_agent(&caller(&operations, unrelated), &target("C"))
                .await,
            Err(AgentOperationsError::AgentNotFound)
        ));
    }
    assert!(operations
        .get_agent(&caller(&operations, "C"), &target("Q"))
        .await
        .is_ok());

    for kind in [AgentCreationKind::Ordinary, AgentCreationKind::Subagent] {
        let decision = operations
            .decide_agent_creation(&caller(&operations, "C"), kind, "workspace-a")
            .expect("creation decision");
        assert_eq!(
            decision.denial,
            Some(CapabilityDenial::SubagentCannotCreateAgent)
        );
    }
}

#[tokio::test]
async fn cross_runtime_targets_are_denied_before_lookup() {
    let operations = fixture(false);
    let foreign = AgentIdentity::new(RuntimeIdentity::new("runtime-2"), "Q");
    assert!(matches!(
        operations
            .get_agent(&caller(&operations, "P"), &foreign)
            .await,
        Err(AgentOperationsError::RuntimeBoundaryDenied)
    ));
}

#[tokio::test]
async fn list_reads_exclude_all_subagents_and_scope_children_to_the_parent() {
    let operations = fixture(true);
    let ordinary = operations
        .list_agents(&caller(&operations, "P"), ListAgentsInput::default())
        .await
        .expect("list ordinary agents");
    assert_eq!(
        ordinary
            .agents
            .iter()
            .map(|agent| agent.identity.session_id.as_str())
            .collect::<Vec<_>>(),
        vec!["P", "Q", "R"]
    );

    let children = operations
        .list_subagents(&caller(&operations, "P"))
        .await
        .expect("list P children");
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].identity.session_id, "C");
    assert_eq!(
        children[0].status.presentation,
        AgentPresentationStatus::Closed
    );
    assert!(!children
        .iter()
        .any(|agent| agent.identity.session_id == "D"));
}

#[tokio::test]
async fn list_pagination_is_stable_regardless_of_session_row_order() {
    fn stamped(id: &str, updated_at: &str) -> SessionRecord {
        let mut record = session(id, "workspace-a", "idle");
        record.updated_at = updated_at.to_string();
        record
    }

    // Distinct `updated_at` values so the stable order (updated_at DESC, id) is
    // total and observably different from insertion order.
    let ascending = vec![
        stamped("A", "2026-08-10T00:00:01Z"),
        stamped("B", "2026-08-10T00:00:02Z"),
        stamped("C", "2026-08-10T00:00:03Z"),
    ];
    // Same rows, reversed insertion order — simulates the store returning rows
    // in a different sequence (e.g. `updated_at` churn reordering the DESC
    // scan) between paginated calls.
    let mut descending = ascending.clone();
    descending.reverse();

    // Stable order is `updated_at` DESC regardless of the underlying row order.
    let expected = vec!["C".to_string(), "B".to_string(), "A".to_string()];

    for records in [ascending, descending] {
        let operations = AgentOperations::new(
            RuntimeIdentity::new("runtime-1"),
            Arc::new(FakeSessions { records }),
            Arc::new(FakeRelationships::default()),
            Arc::new(FakeExecution::default()),
        );
        let caller = caller(&operations, "A");

        // Walk the whole listing one row per page; a stable order plus
        // sort-key cursor resumption must visit every agent exactly once.
        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let page = operations
                .list_agents(
                    &caller,
                    ListAgentsInput {
                        limit: 1,
                        cursor: cursor.clone(),
                        ..ListAgentsInput::default()
                    },
                )
                .await
                .expect("page");
            seen.extend(
                page.agents
                    .iter()
                    .map(|agent| agent.identity.session_id.clone()),
            );
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        assert_eq!(seen, expected);
    }
}

#[tokio::test]
async fn whoami_returns_exact_role_parent_scope_and_effective_capabilities() {
    let operations = fixture(false);
    let ordinary = operations
        .whoami(&caller(&operations, "P"))
        .await
        .expect("ordinary identity");
    assert_eq!(ordinary.agent.role, AgentRole::Ordinary);
    assert!(ordinary.agent.parent.is_none());
    assert_eq!(ordinary.effective_capabilities, AgentCapability::ALL);

    let child = operations
        .whoami(&caller(&operations, "C"))
        .await
        .expect("subagent identity");
    assert_eq!(child.agent.role, AgentRole::Subagent);
    assert_eq!(
        child.agent.parent.expect("parent").session_id,
        "P".to_string()
    );
    assert!(!child
        .effective_capabilities
        .contains(&AgentCapability::CreateAgent));
    assert!(!child
        .effective_capabilities
        .contains(&AgentCapability::PromoteSubagent));
    assert!(child
        .effective_capabilities
        .contains(&AgentCapability::SendMessage));
}

#[tokio::test]
async fn status_projection_separates_presentation_from_execution_detail() {
    let sessions = FakeSessions {
        records: vec![
            session("P", "workspace-a", "idle"),
            session("running", "workspace-a", "running"),
            session("cold", "workspace-a", "idle"),
            session("errored", "workspace-a", "errored"),
            session("closed", "workspace-a", "idle"),
        ],
    };
    let relationships = FakeRelationships {
        links: vec![link("P", "closed", true)],
    };
    let execution = FakeExecution {
        states: HashMap::from([
            (
                "running".to_string(),
                SessionExecutionState {
                    phase: SessionExecutionStatePhase::Running,
                    has_live_handle: true,
                },
            ),
            (
                "cold".to_string(),
                SessionExecutionState {
                    phase: SessionExecutionStatePhase::Idle,
                    has_live_handle: false,
                },
            ),
            (
                "errored".to_string(),
                SessionExecutionState {
                    phase: SessionExecutionStatePhase::Errored,
                    has_live_handle: false,
                },
            ),
        ]),
    };
    let operations = AgentOperations::new(
        RuntimeIdentity::new("runtime-1"),
        Arc::new(sessions),
        Arc::new(relationships),
        Arc::new(execution),
    );
    let caller = caller(&operations, "P");

    let running = operations
        .get_agent(&caller, &target("running"))
        .await
        .expect("running");
    assert_eq!(
        running.status.presentation,
        AgentPresentationStatus::Running
    );
    assert!(running.status.has_live_actor);

    let cold = operations
        .get_agent(&caller, &target("cold"))
        .await
        .expect("cold");
    assert_eq!(cold.status.presentation, AgentPresentationStatus::Available);
    assert_eq!(cold.status.execution, AgentExecutionStatus::Idle);
    assert!(!cold.status.has_live_actor);

    let errored = operations
        .get_agent(&caller, &target("errored"))
        .await
        .expect("errored");
    assert_eq!(
        errored.status.presentation,
        AgentPresentationStatus::Available
    );
    assert_eq!(errored.status.execution, AgentExecutionStatus::Errored);

    let closed = operations
        .get_agent(&caller, &target("closed"))
        .await
        .expect("closed owned child");
    assert_eq!(closed.status.presentation, AgentPresentationStatus::Closed);
    assert_eq!(closed.status.execution, AgentExecutionStatus::Closed);
}

#[tokio::test]
async fn terminal_ordinary_agents_are_hidden_while_relationship_closed_subagents_remain_readable() {
    let terminal_by_status = session("terminal-status", "workspace-a", "closed");
    let mut terminal_by_timestamp = session("terminal-timestamp", "workspace-b", "idle");
    terminal_by_timestamp.closed_at = Some("2026-08-10T01:00:00Z".to_string());
    let sessions = FakeSessions {
        records: vec![
            session("P", "workspace-a", "idle"),
            terminal_by_status,
            terminal_by_timestamp,
            session("C", "workspace-a", "idle"),
        ],
    };
    let operations = AgentOperations::new(
        RuntimeIdentity::new("runtime-1"),
        Arc::new(sessions),
        Arc::new(FakeRelationships {
            links: vec![link("P", "C", true)],
        }),
        Arc::new(FakeExecution::default()),
    );
    let caller = caller(&operations, "P");

    for terminal_id in ["terminal-status", "terminal-timestamp"] {
        assert!(matches!(
            operations.get_agent(&caller, &target(terminal_id)).await,
            Err(AgentOperationsError::AgentNotFound)
        ));
    }
    let ordinary = operations
        .list_agents(&caller, ListAgentsInput::default())
        .await
        .expect("list ordinary agents");
    assert_eq!(
        ordinary
            .agents
            .iter()
            .map(|agent| agent.identity.session_id.as_str())
            .collect::<Vec<_>>(),
        vec!["P"]
    );

    let closed_child = operations
        .get_agent(&caller, &target("C"))
        .await
        .expect("relationship-Closed subagent remains readable");
    assert_eq!(
        closed_child.status.presentation,
        AgentPresentationStatus::Closed
    );
    assert_eq!(
        operations
            .list_subagents(&caller)
            .await
            .expect("list Closed subagent")
            .into_iter()
            .map(|agent| agent.identity.session_id)
            .collect::<Vec<_>>(),
        vec!["C"]
    );
}

#[tokio::test]
async fn pr2_authorization_preserves_closed_relationship_and_terminal_target_distinctions() {
    let closed_relationship = fixture(true);
    assert!(matches!(
        closed_relationship
            .list_agent_config_options(&caller(&closed_relationship, "P"), &target("C"),)
            .await,
        Err(AgentOperationsError::SubagentOpenRequired)
    ));
    assert!(matches!(
        closed_relationship
            .list_agent_config_options(&caller(&closed_relationship, "Q"), &target("C"),)
            .await,
        Err(AgentOperationsError::AgentNotFound)
    ));

    let open_relationship = fixture(false);
    assert!(matches!(
        open_relationship
            .list_agent_config_options(&caller(&open_relationship, "P"), &target("C"))
            .await,
        Err(AgentOperationsError::WorkspaceCatalogsUnavailable)
    ));

    let mut terminal = session("terminal", "workspace-b", "closed");
    terminal.closed_at = Some("2026-08-11T00:00:00Z".to_string());
    let mut dismissed = session("dismissed", "workspace-b", "idle");
    dismissed.dismissed_at = Some("2026-08-11T00:00:00Z".to_string());
    let operations = AgentOperations::new(
        RuntimeIdentity::new("runtime-1"),
        Arc::new(FakeSessions {
            records: vec![session("P", "workspace-a", "idle"), terminal, dismissed],
        }),
        Arc::new(FakeRelationships::default()),
        Arc::new(FakeExecution::default()),
    );
    assert!(matches!(
        operations
            .list_agent_config_options(&caller(&operations, "P"), &target("terminal"))
            .await,
        Err(AgentOperationsError::AgentNotFound)
    ));
    assert!(matches!(
        operations
            .list_agent_config_options(&caller(&operations, "P"), &target("dismissed"))
            .await,
        Err(AgentOperationsError::WorkspaceCatalogsUnavailable)
    ));
}

#[tokio::test]
async fn subagent_callers_cannot_create_workspaces_but_ordinary_callers_pass_the_gate() {
    let input = crate::domains::agent_operations::model::CreateWorkspaceInput {
        repository_id: "repo-1".to_string(),
        creation_mode: "local".to_string(),
        branch: None,
        display_name: None,
    };

    let open = fixture(false);
    // Ordinary caller clears the capability gate and reaches the catalog layer.
    assert!(matches!(
        open.create_workspace(&caller(&open, "P"), input.clone())
            .await,
        Err(AgentOperationsError::WorkspaceCatalogsUnavailable)
    ));

    // ADR Ruling 3: an unpromoted (open) subagent cannot call any spawn-style
    // tool, including create_workspace — it is denied at the capability gate.
    assert!(matches!(
        open.create_workspace(&caller(&open, "C"), input.clone()).await,
        Err(AgentOperationsError::CapabilityDenied {
            capability: AgentCapability::CreateWorkspace,
            denial: CapabilityDenial::ParentOnly,
        })
    ));

    // A closed caller cannot mutate at all.
    let closed = fixture(true);
    assert!(matches!(
        closed.create_workspace(&caller(&closed, "C"), input).await,
        Err(AgentOperationsError::CallerClosed)
    ));
}

#[tokio::test]
async fn pr2_workspace_targets_enforce_the_runtime_boundary_before_owner_reads() {
    let operations = fixture(false);
    let foreign_caller = AuthenticatedAgentCaller::new(RuntimeIdentity::new("runtime-2"), "P");
    assert!(matches!(
        operations
            .list_workspaces(
                &foreign_caller,
                crate::domains::agent_operations::model::ListWorkspacesInput::default(),
            )
            .await,
        Err(AgentOperationsError::RuntimeBoundaryDenied)
    ));
    let foreign_workspace = WorkspaceIdentity {
        runtime_id: RuntimeIdentity::new("runtime-2"),
        workspace_id: "workspace-a".to_string(),
    };
    assert!(matches!(
        operations
            .list_agent_launch_options(&caller(&operations, "P"), &foreign_workspace)
            .await,
        Err(AgentOperationsError::RuntimeBoundaryDenied)
    ));
}
