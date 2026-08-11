use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

use super::*;
use crate::domains::agent_operations::model::{
    AgentIdentity, AuthenticatedAgentCaller, RuntimeIdentity, SendMessageInput, SendMessageStatus,
};
use crate::domains::sessions::admission::{
    NoControllerPolicy, SessionControllerPolicy, SessionMutationAdmission,
};
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::model::{
    SessionExecutionState, SessionExecutionStatePhase, SessionMcpBindingPolicy, SessionRecord,
};
use crate::domains::sessions::prompt::provenance::AgentSessionPromptSource;
use crate::domains::sessions::runtime::SendPromptError;
use crate::domains::workspaces::model::{test_workspace_record, WorkspaceKind, WorkspaceRecord};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::options::{
    CreateWorkspaceFromOptionsInput, CreateWorkspaceFromOptionsResult, WorkspaceCreationOptions,
    WorkspaceOptionsError,
};

struct Sessions(Mutex<HashMap<String, SessionRecord>>);

impl Sessions {
    fn update(&self, session_id: &str, update: impl FnOnce(&mut SessionRecord)) {
        update(self.0.lock().unwrap().get_mut(session_id).unwrap());
    }
}

impl AgentSessionReads for Sessions {
    fn get_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>> {
        Ok(self.0.lock().unwrap().get(session_id).cloned())
    }

    fn list_sessions(&self) -> anyhow::Result<Vec<SessionRecord>> {
        Ok(self.0.lock().unwrap().values().cloned().collect())
    }
}

struct Relationships {
    records: Mutex<Vec<SessionLinkRecord>>,
    child_reads: AtomicUsize,
    child_read: tokio::sync::Notify,
}

impl Relationships {
    fn close(&self, child_session_id: &str) {
        self.records
            .lock()
            .unwrap()
            .iter_mut()
            .find(|link| link.child_session_id == child_session_id)
            .unwrap()
            .closed_at = Some("2026-08-11T01:00:00Z".into());
    }

    async fn wait_for_child_read(&self) {
        while self.child_reads.load(Ordering::SeqCst) == 0 {
            self.child_read.notified().await;
        }
    }
}

impl SubagentRelationshipReads for Relationships {
    fn find_parent_including_closed(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        if child_session_id == "child" {
            self.child_reads.fetch_add(1, Ordering::SeqCst);
            self.child_read.notify_one();
        }
        Ok(self
            .records
            .lock()
            .unwrap()
            .iter()
            .find(|link| link.child_session_id == child_session_id)
            .cloned())
    }

    fn list_children_including_closed(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        Ok(self
            .records
            .lock()
            .unwrap()
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
        session: &SessionRecord,
    ) -> anyhow::Result<SessionExecutionState> {
        Ok(SessionExecutionState {
            phase: match session.status.as_str() {
                "running" => SessionExecutionStatePhase::Running,
                "errored" => SessionExecutionStatePhase::Errored,
                _ => SessionExecutionStatePhase::Idle,
            },
            has_live_handle: session.status == "running",
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct MessageCall {
    target_session_id: String,
    message: String,
    source: AgentSessionPromptSource,
}

struct Messages {
    calls: Mutex<Vec<MessageCall>>,
    next_seq: AtomicI64,
    active: AtomicUsize,
    max_active: AtomicUsize,
    hold: AtomicBool,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}

impl Messages {
    fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            next_seq: AtomicI64::new(1),
            active: AtomicUsize::new(0),
            max_active: AtomicUsize::new(0),
            hold: AtomicBool::new(false),
            entered: tokio::sync::Notify::new(),
            release: tokio::sync::Notify::new(),
        }
    }
}

#[async_trait]
impl AgentMessageQueue for Messages {
    async fn enqueue_agent_message(
        &self,
        target_session_id: &str,
        message: String,
        source: AgentSessionPromptSource,
    ) -> Result<i64, SendPromptError> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_active.fetch_max(active, Ordering::SeqCst);
        self.calls.lock().unwrap().push(MessageCall {
            target_session_id: target_session_id.into(),
            message,
            source,
        });
        self.entered.notify_one();
        if self.hold.load(Ordering::SeqCst) {
            self.release.notified().await;
        }
        self.active.fetch_sub(1, Ordering::SeqCst);
        Ok(self.next_seq.fetch_add(1, Ordering::SeqCst))
    }
}

struct ControlledTarget(Option<String>);

impl SessionControllerPolicy for ControlledTarget {
    fn controlling_run_id(&self, session_id: &str) -> anyhow::Result<Option<String>> {
        Ok((session_id == "peer").then(|| self.0.clone()).flatten())
    }
}

struct Fixture {
    operations: Arc<AgentOperations>,
    sessions: Arc<Sessions>,
    relationships: Arc<Relationships>,
    messages: Arc<Messages>,
    workspaces: Arc<Workspaces>,
    gate: Arc<WorkspaceOperationGate>,
}

fn fixture(closed_child: bool, controlled_peer: bool) -> Fixture {
    let sessions = Arc::new(Sessions(Mutex::new(
        [
            session("parent", "workspace-a", "idle", Some("Parent Label")),
            session("peer", "workspace-b", "idle", Some("Peer")),
            session("running", "workspace-b", "running", Some("Running")),
            session("cold", "workspace-b", "errored", Some("Cold")),
            session("child", "workspace-a", "idle", Some("Child")),
            session("foreign-parent", "workspace-b", "idle", None),
        ]
        .into_iter()
        .map(|record| (record.id.clone(), record))
        .collect(),
    )));
    let relationships = Arc::new(Relationships {
        records: Mutex::new(vec![link("parent", "child", closed_child)]),
        child_reads: AtomicUsize::new(0),
        child_read: tokio::sync::Notify::new(),
    });
    let workspaces = Arc::new(Workspaces {
        records: vec![workspace("workspace-a"), workspace("workspace-b")],
        get_calls: AtomicUsize::new(0),
    });
    let messages = Arc::new(Messages::new());
    let gate = Arc::new(WorkspaceOperationGate::new());
    let controller_policy: Arc<dyn SessionControllerPolicy> = if controlled_peer {
        Arc::new(ControlledTarget(Some("workflow-1".into())))
    } else {
        Arc::new(NoControllerPolicy)
    };
    let admission = Arc::new(SessionMutationAdmission::new(controller_policy));
    let operations = Arc::new(
        AgentOperations::new(
            RuntimeIdentity::new("runtime-1"),
            sessions.clone(),
            relationships.clone(),
            Arc::new(Execution),
        )
        .with_messaging(
            messages.clone(),
            workspaces.clone(),
            admission,
            gate.clone(),
        ),
    );
    Fixture {
        operations,
        sessions,
        relationships,
        messages,
        workspaces,
        gate,
    }
}

#[tokio::test]
async fn send_message_returns_only_a_durable_receipt_and_trusted_caller_provenance() {
    let fixture = fixture(false, false);
    let receipt = fixture
        .operations
        .send_message(
            &caller(&fixture, "parent"),
            input(&fixture, "peer", "  exact message\n"),
        )
        .await
        .expect("send message");

    assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);
    assert_eq!(receipt.queue_seq, 1);
    assert_eq!(receipt.target.session_id, "peer");
    assert_eq!(
        serde_json::to_value(&receipt).unwrap(),
        serde_json::json!({
            "target": { "runtimeId": "runtime-1", "sessionId": "peer" },
            "queueSeq": 1,
            "status": "durably_queued"
        })
    );
    assert_eq!(
        fixture.messages.calls.lock().unwrap().as_slice(),
        &[MessageCall {
            target_session_id: "peer".into(),
            message: "  exact message\n".into(),
            source: AgentSessionPromptSource {
                source_session_id: "parent".into(),
                session_link_id: None,
                label: "Parent Label".into(),
            },
        }]
    );

    fixture
        .operations
        .send_message(
            &caller(&fixture, "parent"),
            input(&fixture, "child", "follow up"),
        )
        .await
        .expect("message owned subagent");
    assert_eq!(
        fixture.messages.calls.lock().unwrap()[1]
            .source
            .session_link_id
            .as_deref(),
        Some("link-child")
    );
}

#[tokio::test]
async fn send_message_idle_running_and_cold_targets_share_the_durable_queue_path() {
    let fixture = fixture(false, false);
    for (index, target) in ["peer", "running", "cold"].into_iter().enumerate() {
        let receipt = fixture
            .operations
            .send_message(
                &caller(&fixture, "parent"),
                input(&fixture, target, &format!("message-{target}")),
            )
            .await
            .expect("state-independent durable enqueue");
        assert_eq!(receipt.queue_seq, index as i64 + 1);
        assert_eq!(receipt.status, SendMessageStatus::DurablyQueued);
    }
    assert_eq!(fixture.messages.calls.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn send_message_denials_happen_before_workspace_or_queue_mutation() {
    let open = fixture(false, false);
    assert!(matches!(
        open.operations
            .send_message(
                &caller(&open, "foreign-parent"),
                input(&open, "child", "secret probe"),
            )
            .await,
        Err(AgentOperationsError::AgentNotFound)
    ));
    assert!(matches!(
        open.operations
            .send_message(
                &caller(&open, "parent"),
                SendMessageInput {
                    target: AgentIdentity::new(RuntimeIdentity::new("runtime-2"), "peer"),
                    message: "cross runtime".into(),
                },
            )
            .await,
        Err(AgentOperationsError::RuntimeBoundaryDenied)
    ));
    assert!(matches!(
        open.operations
            .send_message(
                &caller(&open, "parent"),
                input(&open, "missing", "unknown target"),
            )
            .await,
        Err(AgentOperationsError::AgentNotFound)
    ));
    assert!(open.messages.calls.lock().unwrap().is_empty());
    assert_eq!(open.workspaces.get_calls.load(Ordering::SeqCst), 0);

    open.sessions.update("peer", |record| {
        record.closed_at = Some("2026-08-11T01:00:00Z".into())
    });
    assert!(matches!(
        open.operations
            .send_message(
                &caller(&open, "parent"),
                input(&open, "peer", "closed session"),
            )
            .await,
        Err(AgentOperationsError::AgentNotFound)
    ));
    assert!(open.messages.calls.lock().unwrap().is_empty());
    assert_eq!(open.workspaces.get_calls.load(Ordering::SeqCst), 0);

    let closed = fixture(true, false);
    assert!(matches!(
        closed
            .operations
            .send_message(
                &caller(&closed, "parent"),
                input(&closed, "child", "closed"),
            )
            .await,
        Err(AgentOperationsError::SubagentOpenRequired)
    ));
    assert!(closed.messages.calls.lock().unwrap().is_empty());
    assert_eq!(closed.workspaces.get_calls.load(Ordering::SeqCst), 0);

    let controlled = fixture(false, true);
    assert!(matches!(
        controlled
            .operations
            .send_message(
                &caller(&controlled, "parent"),
                input(&controlled, "peer", "workflow owned"),
            )
            .await,
        Err(AgentOperationsError::ControlledByWorkflow)
    ));
    assert!(controlled.messages.calls.lock().unwrap().is_empty());
    assert_eq!(controlled.workspaces.get_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn send_message_target_gate_rechecks_and_never_leases_the_caller_workspace() {
    let fixture = fixture(false, false);
    let caller_workspace_lock = fixture.gate.acquire_exclusive("workspace-a").await;
    tokio::time::timeout(
        Duration::from_millis(250),
        fixture.operations.send_message(
            &caller(&fixture, "parent"),
            input(&fixture, "peer", "cross-workspace"),
        ),
    )
    .await
    .expect("caller workspace must not be leased")
    .expect("cross-workspace send");
    drop(caller_workspace_lock);

    let target_workspace_lock = fixture.gate.acquire_exclusive("workspace-a").await;
    let operations = fixture.operations.clone();
    let recheck = tokio::spawn(async move {
        operations
            .send_message(
                &operations.authenticated_caller("parent"),
                SendMessageInput {
                    target: AgentIdentity::new(operations.runtime_identity().clone(), "child"),
                    message: "racing close".into(),
                },
            )
            .await
    });
    fixture.relationships.wait_for_child_read().await;
    fixture.relationships.close("child");
    drop(target_workspace_lock);
    assert!(matches!(
        recheck.await.unwrap(),
        Err(AgentOperationsError::SubagentOpenRequired)
    ));
    assert_eq!(
        fixture.messages.calls.lock().unwrap().len(),
        1,
        "the racing Closed target must not reach the queue owner"
    );
}

#[tokio::test]
async fn send_message_contended_prompt_admission_preserves_single_writer_order() {
    let fixture = fixture(false, false);
    fixture.messages.hold.store(true, Ordering::SeqCst);
    let first_operations = fixture.operations.clone();
    let first = tokio::spawn(async move {
        first_operations
            .send_message(
                &first_operations.authenticated_caller("parent"),
                SendMessageInput {
                    target: AgentIdentity::new(first_operations.runtime_identity().clone(), "peer"),
                    message: "first".into(),
                },
            )
            .await
    });
    fixture.messages.entered.notified().await;

    let second_operations = fixture.operations.clone();
    let second = tokio::spawn(async move {
        second_operations
            .send_message(
                &second_operations.authenticated_caller("parent"),
                SendMessageInput {
                    target: AgentIdentity::new(
                        second_operations.runtime_identity().clone(),
                        "peer",
                    ),
                    message: "second".into(),
                },
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(fixture.messages.calls.lock().unwrap().len(), 1);

    fixture.messages.hold.store(false, Ordering::SeqCst);
    fixture.messages.release.notify_one();
    let first_receipt = first.await.unwrap().unwrap();
    let second_receipt = second.await.unwrap().unwrap();
    assert_eq!((first_receipt.queue_seq, second_receipt.queue_seq), (1, 2));
    assert_eq!(fixture.messages.max_active.load(Ordering::SeqCst), 1);
    assert_eq!(
        fixture
            .messages
            .calls
            .lock()
            .unwrap()
            .iter()
            .map(|call| call.message.as_str())
            .collect::<Vec<_>>(),
        vec!["first", "second"]
    );
}

fn session(id: &str, workspace_id: &str, status: &str, title: Option<&str>) -> SessionRecord {
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
        title: title.map(str::to_string),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: status.into(),
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
        id: "link-child".into(),
        public_id: Some("subagent-child".into()),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: parent.into(),
        child_session_id: child.into(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some("Child".into()),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-11T00:00:00Z".into(),
        closed_at: closed.then(|| "2026-08-11T00:30:00Z".into()),
    }
}

fn workspace(id: &str) -> WorkspaceRecord {
    let path = format!("/tmp/{id}");
    let mut workspace = test_workspace_record(WorkspaceKind::Local, &path);
    workspace.id = id.into();
    workspace
}

fn caller(fixture: &Fixture, session_id: &str) -> AuthenticatedAgentCaller {
    fixture.operations.authenticated_caller(session_id)
}

fn input(fixture: &Fixture, target: &str, message: &str) -> SendMessageInput {
    SendMessageInput {
        target: AgentIdentity::new(fixture.operations.runtime_identity().clone(), target),
        message: message.into(),
    }
}
