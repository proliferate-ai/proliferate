use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use super::*;
use crate::domains::agent_operations::model::{
    AgentCreationKind, AgentIdentity, AgentPresentationStatus, AgentRole, CreateAgentInput,
    SendMessageInput, WorkspaceIdentity,
};
use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::catalog::service::ActiveCatalog;
use crate::domains::agents::launch_options::{
    HarnessLaunchDefaults, HarnessLaunchModel, HarnessLaunchOptions, HarnessLaunchOptionsResponse,
    HarnessLaunchOptionsState,
};
use crate::domains::sessions::admission::{
    NoControllerPolicy, SessionMutationAdmission, SessionMutationKind,
};
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::model::{
    SessionExecutionState, SessionExecutionStatePhase, SessionMcpBindingPolicy, SessionRecord,
};
use crate::domains::sessions::prompt::provenance::AgentSessionPromptSource;
use crate::domains::sessions::runtime::{
    CreateSubagentAgentSessionError, SendPromptError, SubagentLifecycleError,
};
use crate::domains::workspaces::model::{test_workspace_record, WorkspaceKind, WorkspaceRecord};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::options::{
    CreateWorkspaceFromOptionsInput, CreateWorkspaceFromOptionsResult, WorkspaceCreationOptions,
    WorkspaceOptionsError,
};

mod race_tests;

#[derive(Default)]
struct State {
    sessions: Mutex<Vec<SessionRecord>>,
    links: Mutex<Vec<SessionLinkRecord>>,
    calls: Mutex<Vec<String>>,
    hold_closed_projection: AtomicBool,
    projection_block_claimed: AtomicBool,
    projection_started: tokio::sync::Notify,
    projection_release: AtomicBool,
}

#[derive(Default)]
struct Queue {
    hold: AtomicBool,
    started: tokio::sync::Notify,
    release: tokio::sync::Notify,
}

#[async_trait]
impl AgentMessageQueue for Queue {
    async fn enqueue_agent_message(
        self: Arc<Self>,
        _target_session_id: &str,
        _message: String,
        _source: AgentSessionPromptSource,
    ) -> Result<i64, SendPromptError> {
        self.started.notify_one();
        if self.hold.load(Ordering::SeqCst) {
            self.release.notified().await;
        }
        Ok(1)
    }
}

impl AgentSessionReads for State {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        Ok(self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .find(|session| session.id == session_id)
            .cloned())
    }

    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>> {
        Ok(self.sessions.lock().unwrap().clone())
    }
}

impl SubagentRelationshipReads for State {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        let relationship = self
            .links
            .lock()
            .unwrap()
            .iter()
            .find(|link| link.child_session_id == child_session_id && link.closed_at.is_none())
            .cloned();
        if relationship
            .as_ref()
            .is_some_and(|link| link.subagent_closed_at.is_some())
            && self.hold_closed_projection.load(Ordering::SeqCst)
            && self
                .projection_block_claimed
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        {
            self.projection_started.notify_one();
            while !self.projection_release.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
        Ok(relationship)
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        Ok(self
            .links
            .lock()
            .unwrap()
            .iter()
            .filter(|link| link.parent_session_id == parent_session_id && link.closed_at.is_none())
            .cloned()
            .collect())
    }
}

#[async_trait]
impl AgentExecutionReads for State {
    async fn execution_state(
        &self,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState> {
        Ok(SessionExecutionState {
            phase: if session.id == "running-child" {
                SessionExecutionStatePhase::Running
            } else {
                SessionExecutionStatePhase::Idle
            },
            has_live_handle: session.native_session_id.is_some(),
        })
    }
}

#[async_trait]
impl SubagentLifecycleMutations for State {
    async fn create_subagent_agent(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        _control_values: &std::collections::BTreeMap<String, String>,
        _task: String,
        parent_session_id: &str,
        _source_label: &str,
    ) -> Result<SessionRecord, CreateSubagentAgentSessionError> {
        self.calls.lock().unwrap().push("create".into());
        let mut created = session("created-child", workspace_id);
        created.agent_kind = agent_kind.to_string();
        created.requested_model_id = model_id.map(str::to_string);
        created.current_model_id = model_id.map(str::to_string);
        created.native_session_id = Some("native-created-child".into());
        self.sessions.lock().unwrap().push(created.clone());
        self.links
            .lock()
            .unwrap()
            .push(link(parent_session_id, &created.id, false));
        Ok(created)
    }

    async fn close_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        self.calls.lock().unwrap().push("close".into());
        let mut links = self.links.lock().unwrap();
        let link = links
            .iter_mut()
            .find(|link| {
                link.parent_session_id == parent_session_id
                    && link.child_session_id == child_session_id
            })
            .ok_or(SubagentLifecycleError::RelationshipNotFound)?;
        if link.subagent_closed_at.is_none() {
            link.subagent_closed_at = Some("2026-08-11T01:00:00Z".into());
        }
        drop(links);
        self.get_session(child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .ok_or(SubagentLifecycleError::RelationshipNotFound)
    }

    async fn open_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        self.calls.lock().unwrap().push("open".into());
        let mut links = self.links.lock().unwrap();
        let link = links
            .iter_mut()
            .find(|link| {
                link.parent_session_id == parent_session_id
                    && link.child_session_id == child_session_id
            })
            .ok_or(SubagentLifecycleError::RelationshipNotFound)?;
        link.subagent_closed_at = None;
        drop(links);
        self.get_session(child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .ok_or(SubagentLifecycleError::RelationshipNotFound)
    }

    async fn promote_subagent(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionRecord, SubagentLifecycleError> {
        self.calls.lock().unwrap().push("promote".into());
        let mut links = self.links.lock().unwrap();
        let position = links
            .iter()
            .position(|link| {
                link.parent_session_id == parent_session_id
                    && link.child_session_id == child_session_id
            })
            .ok_or(SubagentLifecycleError::RelationshipNotFound)?;
        if links[position].subagent_closed_at.is_some() {
            return Err(SubagentLifecycleError::OpenRequired);
        }
        links.remove(position);
        drop(links);
        self.get_session(child_session_id)
            .map_err(SubagentLifecycleError::Internal)?
            .ok_or(SubagentLifecycleError::RelationshipNotFound)
    }
}

struct Workspaces(Vec<WorkspaceRecord>);

#[async_trait]
impl AgentWorkspaceOperations for Workspaces {
    async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, WorkspaceOptionsError> {
        Ok(self.0.clone())
    }

    async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceRecord>, WorkspaceOptionsError> {
        Ok(self
            .0
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .cloned())
    }

    async fn list_workspace_options(
        &self,
    ) -> Result<WorkspaceCreationOptions, WorkspaceOptionsError> {
        unreachable!()
    }

    async fn create_workspace(
        &self,
        _caller_workspace_id: &str,
        _input: CreateWorkspaceFromOptionsInput,
    ) -> Result<CreateWorkspaceFromOptionsResult, WorkspaceOptionsError> {
        unreachable!()
    }
}

struct LaunchOptions(Vec<HarnessLaunchOptionsResponse>);

impl AgentLaunchOptionReads for LaunchOptions {
    fn harness_launch_options(&self) -> anyhow::Result<Vec<HarnessLaunchOptionsResponse>> {
        Ok(self.0.clone())
    }
}

struct Catalog(ActiveCatalog);

impl AgentCatalogReads for Catalog {
    fn active_catalog(&self) -> ActiveCatalog {
        self.0.clone()
    }

    fn checked_live_config_snapshot(
        &self,
        _session_id: &str,
    ) -> anyhow::Result<Option<crate::domains::sessions::live_config::EffectiveLiveConfigSnapshot>>
    {
        Ok(None)
    }

    fn live_model_switch_authorized(&self, _session: &SessionRecord, _value: &str) -> bool {
        false
    }
}

fn fixture(closed: bool) -> (Arc<AgentOperations>, Arc<State>, Arc<Queue>, String, String) {
    let state = Arc::new(State::default());
    state.sessions.lock().unwrap().extend([
        session("parent", "workspace-a"),
        session("other", "workspace-a"),
        session("child", "workspace-a"),
        session("running-child", "workspace-a"),
    ]);
    state.links.lock().unwrap().extend([
        link("parent", "child", closed),
        link("parent", "running-child", false),
    ]);

    let active = ActiveCatalog::new(Arc::new(bundled_agent_catalog_document().clone()));
    let agent = active
        .agents()
        .iter()
        .find(|agent| !agent.session.presentation_models.is_empty())
        .unwrap();
    let model = &agent.session.presentation_models[0];
    let agent_kind = agent.kind.clone();
    let model_id = model.id.clone();
    let launch = vec![HarnessLaunchOptionsResponse {
        harness_kind: agent.kind.clone(),
        basis_revision: "basis-1".into(),
        revision: 1,
        state: HarnessLaunchOptionsState::Observed,
        options: Some(HarnessLaunchOptions {
            models: vec![HarnessLaunchModel {
                id: model.id.clone(),
                observed_name: None,
                observed_description: None,
            }],
            controls: Vec::new(),
            defaults: HarnessLaunchDefaults {
                model_id: Some(model.id.clone()),
                control_values: Default::default(),
            },
            model_controls: Vec::new(),
        }),
        observed_at: Some("2026-08-19T00:00:00Z".into()),
        probe_attempted_at: "2026-08-19T00:00:00Z".into(),
        probe_failure_code: None,
    }];
    let mut workspace = test_workspace_record(WorkspaceKind::Local, "/tmp/workspace-a");
    workspace.id = "workspace-a".into();
    let workspaces = Arc::new(Workspaces(vec![workspace]));
    let admission = Arc::new(SessionMutationAdmission::new(
        Arc::new(NoControllerPolicy),
        Arc::new(crate::domains::sessions::admission::AllSessionsOperable),
    ));
    let gate = Arc::new(WorkspaceOperationGate::new());
    let queue = Arc::new(Queue::default());
    let operations = Arc::new(
        AgentOperations::new(
            RuntimeIdentity::new("runtime-1"),
            state.clone(),
            state.clone(),
            state.clone(),
        )
        .with_workspace_catalogs(
            workspaces.clone(),
            Arc::new(LaunchOptions(launch)),
            Arc::new(Catalog(active)),
        )
        .with_subagent_lifecycle(
            state.clone(),
            workspaces.clone(),
            admission.clone(),
            gate.clone(),
        )
        .with_messaging(queue.clone(), workspaces, admission, gate),
    );
    (operations, state, queue, agent_kind, model_id)
}

fn session(id: &str, workspace_id: &str) -> SessionRecord {
    SessionRecord {
        id: id.into(),
        workspace_id: workspace_id.into(),
        agent_kind: "codex".into(),
        native_session_id: Some(format!("native-{id}")),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: Some(id.into()),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".into(),
        created_at: "2026-08-11T00:00:00Z".into(),
        updated_at: "2026-08-11T00:00:00Z".into(),
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
        parent_session_id: parent.into(),
        child_session_id: child.into(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: None,
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-11T00:00:00Z".into(),
        subagent_closed_at: closed.then(|| "2026-08-11T00:30:00Z".into()),
        closed_at: None,
    }
}

fn caller(operations: &AgentOperations, id: &str) -> AuthenticatedAgentCaller {
    operations.authenticated_caller(id)
}

fn target(id: &str) -> AgentIdentity {
    AgentIdentity::new(RuntimeIdentity::new("runtime-1"), id)
}

#[tokio::test]
async fn create_subagent_preserves_one_stable_identity_and_relationship() {
    let (operations, state, _, agent_kind, model_id) = fixture(false);
    let created = operations
        .create_agent(
            &caller(&operations, "parent"),
            CreateAgentInput {
                workspace: WorkspaceIdentity {
                    runtime_id: RuntimeIdentity::new("runtime-1"),
                    workspace_id: "workspace-a".into(),
                },
                kind: AgentCreationKind::Subagent,
                task: Some("research the session path".into()),
                agent_kind: Some(agent_kind),
                model_id: Some(model_id),
                control_values: Default::default(),
            },
        )
        .await
        .expect("subagent create");
    assert_eq!(created.identity.session_id, "created-child");
    assert_eq!(created.role, AgentRole::Subagent);
    assert_eq!(created.parent.unwrap().session_id, "parent");
    assert_eq!(state.calls.lock().unwrap().as_slice(), ["create"]);
}

#[tokio::test]
async fn subagent_create_waits_on_the_parent_session_permit() {
    let (operations, state, _, agent_kind, model_id) = fixture(false);
    let held = operations
        .admit_target("parent", SessionMutationKind::Close)
        .await
        .expect("hold parent mutation permit");
    let create_operations = operations.clone();
    let create = tokio::spawn(async move {
        create_operations
            .create_agent(
                &create_operations.authenticated_caller("parent"),
                CreateAgentInput {
                    workspace: WorkspaceIdentity {
                        runtime_id: RuntimeIdentity::new("runtime-1"),
                        workspace_id: "workspace-a".into(),
                    },
                    kind: AgentCreationKind::Subagent,
                    task: Some("serialized child".into()),
                    agent_kind: Some(agent_kind),
                    model_id: Some(model_id),
                    control_values: Default::default(),
                },
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(state.calls.lock().unwrap().is_empty());
    assert!(!create.is_finished());

    drop(held);
    create
        .await
        .unwrap()
        .expect("creation proceeds after parent gate");
    assert_eq!(state.calls.lock().unwrap().as_slice(), ["create"]);
}

#[tokio::test]
async fn close_and_open_are_idempotent_and_preserve_session_identity() {
    let (operations, state, _, _, _) = fixture(false);
    for _ in 0..2 {
        let closed = operations
            .close_subagent(&caller(&operations, "parent"), &target("child"))
            .await
            .expect("idempotent close");
        assert_eq!(closed.status.presentation, AgentPresentationStatus::Closed);
        assert_eq!(closed.identity.session_id, "child");
    }
    for _ in 0..2 {
        let opened = operations
            .open_subagent(&caller(&operations, "parent"), &target("child"))
            .await
            .expect("idempotent open");
        assert_eq!(
            opened.status.presentation,
            AgentPresentationStatus::Available
        );
        assert_eq!(opened.identity.session_id, "child");
    }
    let durable = state.get_session("child").unwrap().unwrap();
    assert_eq!(durable.native_session_id.as_deref(), Some("native-child"));
    assert!(durable.closed_at.is_none());
}

#[tokio::test]
async fn live_promotion_removes_relationship_without_changing_execution() {
    let (operations, state, _, _, _) = fixture(false);
    let promoted = operations
        .promote_subagent(&caller(&operations, "parent"), &target("running-child"))
        .await
        .expect("live promotion");
    assert_eq!(promoted.role, AgentRole::Ordinary);
    assert!(promoted.parent.is_none());
    assert_eq!(
        promoted.status.presentation,
        AgentPresentationStatus::Running
    );
    assert_eq!(promoted.status.execution, AgentExecutionStatus::Running);
    assert_eq!(
        state
            .get_session("running-child")
            .unwrap()
            .unwrap()
            .native_session_id
            .as_deref(),
        Some("native-running-child")
    );
    assert!(state
        .links
        .lock()
        .unwrap()
        .iter()
        .all(|link| link.child_session_id != "running-child"));
}

#[tokio::test]
async fn closed_promotion_requires_open_and_wrong_parent_is_anti_enumerated() {
    let (operations, state, _, _, _) = fixture(true);
    let closed = operations
        .promote_subagent(&caller(&operations, "parent"), &target("child"))
        .await;
    assert!(matches!(
        closed,
        Err(AgentOperationsError::SubagentOpenRequired)
    ));
    let wrong_parent = operations
        .close_subagent(&caller(&operations, "other"), &target("child"))
        .await;
    assert!(matches!(
        wrong_parent,
        Err(AgentOperationsError::AgentNotFound)
    ));
    assert!(state.calls.lock().unwrap().is_empty());
}
