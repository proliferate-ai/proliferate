use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{
    extract_tagged_proposed_plan, finalize_established_actor_exit, find_select_option_for_request,
    first_prompt_system_prompt_append_for_codex_prompt, handle_notification,
    handle_notification_with_resume_replay_filter, is_mode_config_request, is_model_config_request,
    load_startup_restore_snapshot, normalized_key_rank, pending_config_rank,
    persisted_control_values, prepend_system_prompt_append_to_acp_blocks,
    resolve_pending_interactions, serialize_meta, should_apply_model_via_direct_setter,
    should_emit_empty_turn_error, title_from_markdown, tracked_config_purpose,
    ActorExitDisposition, InteractionResolution, LiveSessionExecutionSnapshot, LiveSessionHandle,
    NativeSessionStartupDisposition, PersistedSessionConfigState, PromptDiagnostics,
    ResumeReplayFilter, SessionCommand, SessionStartupState, IDLE_RESUME_REPLAY_QUIET_WINDOW,
};
use crate::acp::background_work::{BackgroundWorkOptions, BackgroundWorkRegistry};
use crate::acp::event_sink::{SessionEventSink, SessionEventSinkDebugSnapshot};
use crate::acp::permission_broker::{InteractionBroker, PermissionOutcome};
use crate::domains::agents::model::{
    AgentKind, ArtifactRole, CredentialState, ResolvedAgent, ResolvedAgentStatus, ResolvedArtifact,
};
use crate::domains::agents::registry::built_in_registry;
use crate::domains::plans::{service::PlanService, store::PlanStore};
use crate::live::sessions::connection::native_session::{
    build_system_prompt_meta, is_missing_load_session_resource,
};
use crate::live::sessions::connection::process::merge_spawn_env;
use crate::live::sessions::connection::start::build_client_capabilities;
use crate::live::sessions::connection::stderr::{
    classify_agent_stderr_line, sanitize_agent_stderr_line, AgentStderrSeverity,
};
use crate::persistence::Db;
use crate::sessions::live_config::{snapshot_to_record, NormalizedControlKind};
use crate::sessions::{model::SessionRecord, store::SessionStore};
use agent_client_protocol as acp;
use anyharness_contract::v1::{
    InteractionKind, NormalizedSessionControl, NormalizedSessionControlValue,
    NormalizedSessionControls, PendingInteractionPayloadSummary, PendingInteractionSource,
    PendingInteractionSummary, PermissionInteractionOption, PermissionInteractionOptionKind,
    SessionEventEnvelope, SessionExecutionPhase, SessionLiveConfigSnapshot, StopReason,
};
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

mod config;
mod connection;
mod notifications;
mod prompt;
mod shutdown;

fn test_plan_service(db: &Db) -> Arc<PlanService> {
    Arc::new(PlanService::new(PlanStore::new(db.clone())))
}

async fn actor_exit_test_context(
    pending_interaction: Option<PendingInteractionSummary>,
) -> (
    SessionStore,
    Arc<Mutex<SessionEventSink>>,
    Arc<InteractionBroker>,
    Arc<LiveSessionHandle>,
) {
    let db = Db::open_in_memory().expect("open db");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
             VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");

    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        })
        .expect("insert session");

    let (command_tx, _command_rx) = mpsc::channel::<SessionCommand>(4);
    let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(16);
    let phase = if pending_interaction.is_some() {
        SessionExecutionPhase::AwaitingInteraction
    } else {
        SessionExecutionPhase::Running
    };
    let mut execution = LiveSessionExecutionSnapshot::new(phase);
    let interaction_broker = Arc::new(InteractionBroker::new());
    if let Some(pending_interaction) = pending_interaction {
        let request_id = pending_interaction.request_id.clone();
        execution.pending_interactions.push(pending_interaction);
        interaction_broker
            .insert_pending_for_test(
                "session-1",
                &request_id,
                vec![acp::PermissionOption::new(
                    acp::PermissionOptionId::new("allow"),
                    "Allow",
                    acp::PermissionOptionKind::AllowOnce,
                )],
            )
            .await;
    }

    let handle = Arc::new(LiveSessionHandle {
        session_id: "session-1".to_string(),
        command_tx,
        event_tx: event_tx.clone(),
        busy: Arc::new(AtomicBool::new(false)),
        execution: Arc::new(RwLock::new(execution)),
        native_session_id: Arc::new(std::sync::RwLock::new(Some("native-1".to_string()))),
    });

    let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx,
        store.clone(),
    )));

    (store, event_sink, interaction_broker, handle)
}

fn pending_interaction_summary() -> PendingInteractionSummary {
    PendingInteractionSummary {
        request_id: "perm-1".to_string(),
        kind: InteractionKind::Permission,
        title: "Run command".to_string(),
        description: None,
        source: PendingInteractionSource {
            tool_call_id: Some("tool-1".to_string()),
            tool_kind: Some("execute".to_string()),
            tool_status: None,
            linked_plan_id: None,
        },
        payload: PendingInteractionPayloadSummary::Permission {
            options: vec![PermissionInteractionOption {
                option_id: "allow".to_string(),
                label: "Allow".to_string(),
                kind: PermissionInteractionOptionKind::AllowOnce,
            }],
            context: None,
        },
    }
}

fn resolved_agent_with_source(kind: AgentKind, source: &str) -> ResolvedAgent {
    let descriptor = built_in_registry()
        .into_iter()
        .find(|descriptor| descriptor.kind == kind)
        .expect("missing descriptor");
    let artifact_path = format!("/tmp/{}/agent", kind.as_str());

    ResolvedAgent {
        descriptor,
        status: ResolvedAgentStatus::Ready,
        credential_state: CredentialState::Ready,
        native: None,
        agent_process: ResolvedArtifact {
            role: ArtifactRole::AgentProcess,
            installed: true,
            source: Some(source.to_string()),
            version: None,
            path: Some(PathBuf::from(artifact_path)),
            message: None,
        },
        spawn: None,
    }
}

fn capability_bool(
    capabilities: &acp::ClientCapabilities,
    agent: &str,
    capability: &str,
) -> Option<bool> {
    capabilities
        .meta
        .as_ref()?
        .get(agent)?
        .get(capability)?
        .as_bool()
}

fn test_background_work_registry(store: &SessionStore) -> BackgroundWorkRegistry {
    let (updates_tx, _updates_rx) = mpsc::unbounded_channel();
    BackgroundWorkRegistry::new(
        "session-1".to_string(),
        "claude".to_string(),
        store.clone(),
        updates_tx,
        BackgroundWorkOptions::default(),
    )
}
