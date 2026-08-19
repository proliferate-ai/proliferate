use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

use super::*;
use crate::domains::agent_operations::model::{
    AgentConfigApplyState, AgentConfigChoiceError, AgentCreationKind, AgentLaunchSelectionError,
    ConfigureAgentInput, CreateAgentInput,
};
use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::catalog::service::ActiveCatalog;
use crate::domains::agents::launch_options::{
    HarnessLaunchControl, HarnessLaunchControlValue, HarnessLaunchDefaults, HarnessLaunchModel,
    HarnessLaunchOptions, HarnessLaunchOptionsResponse, HarnessLaunchOptionsState,
};
use crate::domains::sessions::admission::{NoControllerPolicy, SessionMutationAdmission};
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::live_config::{
    EffectiveLiveConfigControl, EffectiveLiveConfigSnapshot, EffectiveLiveConfigValue,
};
use crate::domains::sessions::model::{
    SessionExecutionState, SessionExecutionStatePhase, SessionMcpBindingPolicy, SessionRecord,
};
use crate::domains::sessions::runtime::{
    CreateOrdinaryAgentSessionError, EnsureLiveSessionError, SessionLifecycleError,
    SetSessionConfigOptionError,
};
use crate::domains::sessions::task_output::{
    TaskOutputError, TaskOutputMessage, TaskOutputPage, TaskOutputRole, TaskOutputSender,
};
use crate::domains::workspaces::model::{test_workspace_record, WorkspaceKind, WorkspaceRecord};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::options::{
    CreateWorkspaceFromOptionsInput, CreateWorkspaceFromOptionsResult, WorkspaceCreationOptions,
    WorkspaceOptionsError,
};

#[path = "ordinary_output_tests.rs"]
mod output_tests;
#[path = "ordinary_review_tests.rs"]
mod review_tests;

struct Sessions(Vec<SessionRecord>);

impl AgentSessionReads for Sessions {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        Ok(self
            .0
            .iter()
            .find(|record| record.id == session_id)
            .cloned())
    }

    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>> {
        Ok(self.0.clone())
    }
}

struct Relationships(Vec<SessionLinkRecord>);

impl SubagentRelationshipReads for Relationships {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        Ok(self
            .0
            .iter()
            .find(|link| link.child_session_id == child_session_id)
            .cloned())
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        Ok(self
            .0
            .iter()
            .filter(|link| link.parent_session_id == parent_session_id)
            .cloned()
            .collect())
    }
}

struct Execution;

#[async_trait]
impl AgentExecutionReads for Execution {
    async fn execution_state(
        &self,
        _session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState> {
        Ok(SessionExecutionState {
            phase: SessionExecutionStatePhase::Idle,
            has_live_handle: false,
        })
    }
}

struct Workspaces {
    records: Vec<WorkspaceRecord>,
    get_calls: AtomicUsize,
}

#[async_trait]
impl AgentWorkspaceOperations for Workspaces {
    async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, WorkspaceOptionsError> {
        Ok(self.records.clone())
    }

    async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<WorkspaceRecord>, WorkspaceOptionsError> {
        self.get_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .records
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .cloned())
    }

    async fn list_workspace_options(
        &self,
    ) -> Result<WorkspaceCreationOptions, WorkspaceOptionsError> {
        Err(WorkspaceOptionsError::Create(anyhow::anyhow!(
            "unexpected workspace-options call"
        )))
    }

    async fn create_workspace(
        &self,
        _caller_workspace_id: &str,
        _input: CreateWorkspaceFromOptionsInput,
    ) -> Result<CreateWorkspaceFromOptionsResult, WorkspaceOptionsError> {
        Err(WorkspaceOptionsError::Create(anyhow::anyhow!(
            "unexpected workspace-create call"
        )))
    }
}

struct LaunchOptions(Vec<HarnessLaunchOptionsResponse>);

impl AgentLaunchOptionReads for LaunchOptions {
    fn harness_launch_options(&self) -> anyhow::Result<Vec<HarnessLaunchOptionsResponse>> {
        Ok(self.0.clone())
    }
}

struct Catalog {
    active: ActiveCatalog,
}

impl AgentCatalogReads for Catalog {
    fn active_catalog(&self) -> ActiveCatalog {
        self.active.clone()
    }

    fn checked_live_config_snapshot(
        &self,
        _session_id: &str,
    ) -> anyhow::Result<Option<EffectiveLiveConfigSnapshot>> {
        Ok(Some(EffectiveLiveConfigSnapshot {
            controls: vec![EffectiveLiveConfigControl {
                key: "effort".into(),
                config_id: "effort".into(),
                label: "Effort".into(),
                current_value: Some("medium".into()),
                settable: true,
                values: vec![EffectiveLiveConfigValue {
                    value: "high".into(),
                    label: "High".into(),
                    description: None,
                }],
            }],
        }))
    }

    fn live_model_switch_authorized(&self, _session: &SessionRecord, _value: &str) -> bool {
        false
    }
}

struct Mutations {
    calls: Mutex<Vec<String>>,
    config_error: Mutex<Option<SetSessionConfigOptionError>>,
    active_resumes: AtomicUsize,
    max_active_resumes: AtomicUsize,
    agent_kind: String,
    model_id: String,
}

impl Mutations {
    fn record(&self, call: impl Into<String>) {
        self.calls.lock().unwrap().push(call.into());
    }
}

#[async_trait]
impl AgentSessionMutations for Mutations {
    async fn create_ordinary_agent(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        control_values: &std::collections::BTreeMap<String, String>,
        task: Option<String>,
        source_session_id: &str,
        source_label: &str,
    ) -> Result<SessionRecord, CreateOrdinaryAgentSessionError> {
        self.record(format!(
            "create:{workspace_id}:{agent_kind}:{model_id:?}:{control_values:?}:{task:?}:{source_session_id}:{source_label}"
        ));
        let mut created = session("created", workspace_id, &self.agent_kind, &self.model_id);
        created.native_session_id = Some("native-created".into());
        Ok(created)
    }

    async fn configure_agent(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(SessionRecord, AgentConfigMutationState), SetSessionConfigOptionError> {
        self.record(format!("configure:{session_id}:{config_id}:{value}"));
        if let Some(error) = self.config_error.lock().unwrap().take() {
            return Err(error);
        }
        Ok((
            session(session_id, "workspace-b", &self.agent_kind, &self.model_id),
            AgentConfigMutationState::Queued,
        ))
    }

    async fn resume_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, EnsureLiveSessionError> {
        self.record(format!("resume:{session_id}"));
        let active = self.active_resumes.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_active_resumes.fetch_max(active, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(10)).await;
        self.active_resumes.fetch_sub(1, Ordering::SeqCst);
        let mut record = session(session_id, "workspace-b", &self.agent_kind, &self.model_id);
        record.native_session_id = Some("native-stable".into());
        Ok(record)
    }

    async fn interrupt_agent(
        &self,
        session_id: &str,
    ) -> Result<SessionRecord, SessionLifecycleError> {
        self.record(format!("interrupt:{session_id}"));
        Ok(session(
            session_id,
            "workspace-b",
            &self.agent_kind,
            &self.model_id,
        ))
    }
}

struct TaskOutput;

impl AgentTaskOutputReads for TaskOutput {
    fn task_output(
        &self,
        _session_id: &str,
        _cursor: Option<&str>,
        _limit: usize,
    ) -> Result<TaskOutputPage, TaskOutputError> {
        Ok(TaskOutputPage {
            messages: vec![TaskOutputMessage {
                role: TaskOutputRole::Assistant,
                timestamp: "2026-08-11T00:00:00Z".into(),
                sender: TaskOutputSender::Agent {
                    session_id: Some("child".into()),
                    label: "codex".into(),
                },
                text: "done".into(),
                truncated: false,
            }],
            next_cursor: None,
            truncated: false,
        })
    }
}

struct Fixture {
    operations: Arc<AgentOperations>,
    mutations: Arc<Mutations>,
    workspaces: Arc<Workspaces>,
    session_admission: Arc<SessionMutationAdmission>,
    workspace_gate: Arc<WorkspaceOperationGate>,
    agent_kind: String,
    model_id: String,
}

fn fixture(closed_child: bool) -> Fixture {
    let active = ActiveCatalog::new(Arc::new(bundled_agent_catalog_document().clone()));
    let catalog_agent = active
        .agents()
        .iter()
        .find(|agent| !agent.session.presentation_models.is_empty())
        .unwrap();
    let catalog_model = &catalog_agent.session.presentation_models[0];
    let agent_kind = catalog_agent.kind.clone();
    let model_id = catalog_model.id.clone();
    let launch = vec![HarnessLaunchOptionsResponse {
        harness_kind: agent_kind.clone(),
        basis_revision: "basis-1".into(),
        revision: 1,
        state: HarnessLaunchOptionsState::Observed,
        options: Some(HarnessLaunchOptions {
            models: vec![HarnessLaunchModel {
                id: model_id.clone(),
                observed_name: None,
                observed_description: None,
            }],
            controls: vec![HarnessLaunchControl {
                id: "mode".to_string(),
                observed_label: Some("Mode".to_string()),
                observed_description: None,
                values: vec![HarnessLaunchControlValue {
                    value: "mode-a".to_string(),
                    observed_label: Some("Mode A".to_string()),
                    observed_description: None,
                }],
            }],
            defaults: HarnessLaunchDefaults {
                model_id: Some(model_id.clone()),
                control_values: Default::default(),
            },
        }),
        observed_at: Some("2026-08-19T00:00:00Z".into()),
        probe_attempted_at: "2026-08-19T00:00:00Z".into(),
        probe_failure_code: None,
    }];
    let sessions = Arc::new(Sessions(vec![
        session("parent", "workspace-a", &agent_kind, &model_id),
        session("peer", "workspace-b", &agent_kind, &model_id),
        session("child", "workspace-a", &agent_kind, &model_id),
    ]));
    let relationships = Arc::new(Relationships(vec![SessionLinkRecord {
        id: "link-child".into(),
        public_id: Some("subagent-child".into()),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: "parent".into(),
        child_session_id: "child".into(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some("Child".into()),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-11T00:00:00Z".into(),
        subagent_closed_at: closed_child.then(|| "2026-08-11T00:01:00Z".into()),
        closed_at: None,
    }]));
    let mut workspace_a = test_workspace_record(WorkspaceKind::Local, "/tmp/workspace-a");
    workspace_a.id = "workspace-a".into();
    let mut workspace_b = test_workspace_record(WorkspaceKind::Local, "/tmp/workspace-b");
    workspace_b.id = "workspace-b".into();
    let workspaces = Arc::new(Workspaces {
        records: vec![workspace_a, workspace_b],
        get_calls: AtomicUsize::new(0),
    });
    let mutations = Arc::new(Mutations {
        calls: Mutex::new(Vec::new()),
        config_error: Mutex::new(None),
        active_resumes: AtomicUsize::new(0),
        max_active_resumes: AtomicUsize::new(0),
        agent_kind: agent_kind.clone(),
        model_id: model_id.clone(),
    });
    let session_admission = Arc::new(SessionMutationAdmission::new(
        Arc::new(NoControllerPolicy),
        Arc::new(crate::domains::sessions::admission::AllSessionsOperable),
    ));
    let workspace_gate = Arc::new(WorkspaceOperationGate::new());
    let operations = Arc::new(
        AgentOperations::new(
            RuntimeIdentity::new("runtime-1"),
            sessions,
            relationships,
            Arc::new(Execution),
        )
        .with_workspace_catalogs(
            workspaces.clone(),
            Arc::new(LaunchOptions(launch)),
            Arc::new(Catalog { active }),
        )
        .with_ordinary_operations(
            mutations.clone(),
            Arc::new(TaskOutput),
            session_admission.clone(),
            workspace_gate.clone(),
        ),
    );
    Fixture {
        operations,
        mutations,
        workspaces,
        session_admission,
        workspace_gate,
        agent_kind,
        model_id,
    }
}

fn session(id: &str, workspace_id: &str, agent_kind: &str, model_id: &str) -> SessionRecord {
    SessionRecord {
        id: id.into(),
        workspace_id: workspace_id.into(),
        agent_kind: agent_kind.into(),
        native_session_id: Some(format!("native-{id}")),
        agent_auth_contexts: None,
        requested_model_id: Some(model_id.into()),
        current_model_id: Some(model_id.into()),
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

fn caller(operations: &AgentOperations, session_id: &str) -> AuthenticatedAgentCaller {
    operations.authenticated_caller(session_id)
}

fn target(session_id: &str) -> AgentIdentity {
    AgentIdentity::new(RuntimeIdentity::new("runtime-1"), session_id)
}

#[tokio::test]
async fn cross_workspace_create_uses_current_launch_choice_and_stays_unlinked() {
    let fixture = fixture(false);
    let created = fixture
        .operations
        .create_agent(
            &caller(&fixture.operations, "parent"),
            CreateAgentInput {
                workspace: WorkspaceIdentity {
                    runtime_id: RuntimeIdentity::new("runtime-1"),
                    workspace_id: "workspace-b".into(),
                },
                kind: AgentCreationKind::Ordinary,
                task: Some("implement the change".into()),
                agent_kind: Some(fixture.agent_kind.clone()),
                model_id: Some(fixture.model_id.clone()),
                control_values: [("mode".to_string(), "mode-a".to_string())].into(),
            },
        )
        .await
        .expect("cross-workspace ordinary create");
    assert_eq!(created.identity.session_id, "created");
    assert_eq!(created.workspace.workspace_id, "workspace-b");
    assert_eq!(created.role, AgentRole::Ordinary);
    assert!(created.parent.is_none());
    let calls = fixture.mutations.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].ends_with(":parent:parent"));
}

#[tokio::test]
async fn subagent_caller_is_denied_for_both_kinds_before_any_owner_effect() {
    let fixture = fixture(false);
    for kind in [AgentCreationKind::Ordinary, AgentCreationKind::Subagent] {
        let result = fixture
            .operations
            .create_agent(
                &caller(&fixture.operations, "child"),
                CreateAgentInput {
                    workspace: WorkspaceIdentity {
                        runtime_id: RuntimeIdentity::new("runtime-1"),
                        workspace_id: "workspace-a".into(),
                    },
                    kind,
                    task: Some("task".into()),
                    agent_kind: Some(fixture.agent_kind.clone()),
                    model_id: Some(fixture.model_id.clone()),
                    control_values: Default::default(),
                },
            )
            .await;
        assert!(matches!(
            result,
            Err(AgentOperationsError::CapabilityDenied {
                denial: CapabilityDenial::SubagentCannotCreateAgent,
                ..
            })
        ));
    }
    assert!(fixture.mutations.calls.lock().unwrap().is_empty());
    assert_eq!(fixture.workspaces.get_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn stale_launch_and_config_choices_are_typed_and_side_effect_free() {
    let fixture = fixture(false);
    let launch = fixture
        .operations
        .create_agent(
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
        )
        .await;
    assert!(matches!(
        launch,
        Err(AgentOperationsError::LaunchSelection(
            AgentLaunchSelectionError::ModelUnknown
        ))
    ));

    let config = fixture
        .operations
        .configure_agent(
            &caller(&fixture.operations, "parent"),
            ConfigureAgentInput {
                target: target("peer"),
                config_id: "effort".into(),
                value: "stale".into(),
            },
        )
        .await;
    assert!(matches!(
        config,
        Err(AgentOperationsError::ConfigChoice(
            AgentConfigChoiceError::ValueUnknown
        ))
    ));
    assert!(fixture.mutations.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn busy_config_is_successfully_reported_as_queued() {
    let fixture = fixture(false);
    let result = fixture
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
        .expect("queued config is success");
    assert_eq!(result.apply_state, AgentConfigApplyState::Queued);
    assert_eq!(result.agent.identity.session_id, "peer");
    assert_eq!(
        fixture.mutations.calls.lock().unwrap().as_slice(),
        ["configure:peer:effort:high"]
    );
}
