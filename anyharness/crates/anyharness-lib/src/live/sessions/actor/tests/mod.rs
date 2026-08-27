use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::command::{Resolution, SessionCommand};
use super::config::apply::should_apply_model_via_direct_setter;
use super::config::confirmation::{
    ensure_config_values_confirmed, select_option_current_value_matches,
    select_setter_response_outcome,
};
use super::config::handle::{
    apply_resolved_launch_intent, ensure_resolved_launch_intent_confirmed,
    initial_control_disposition, intent_without_dropped_controls, InitialControlDisposition,
};
use super::config::persist::{emit_live_config_update, load_startup_restore_snapshot};
use super::config::queue::{
    pending_model_is_in_latest_live_snapshot, queue_pending_config_change,
};
use super::config::restore::canonical_restore_values;
use super::config::selection::{
    find_select_option_for_request, is_mode_config_request, is_model_config_request,
    pending_config_rank, resolve_model_variant_value, select_option_values,
};
use super::config::types::{
    tracked_config_purpose, ConfigApplyOutcome, PersistedSessionConfigState,
};
use super::interactions::cleanup::resolve_pending_interactions;
use super::notifications::handle::{
    handle_notification, handle_notification_with_resume_replay_filter,
};
use super::notifications::replay_filter::{ResumeReplayFilter, IDLE_RESUME_REPLAY_QUIET_WINDOW};
use super::run::{select_idle_work, IdleWork, STARTUP_QUEUE_DRAIN_GRACE};
use super::shutdown::handle::finalize_established_actor_exit;
use super::shutdown::types::ActorExitDisposition;
use super::startup::queue_launch_observation_refresh;
use super::state::SessionStartupState;
use super::turn::diagnostics::PromptDiagnostics;
use super::turn::finish::should_emit_empty_turn_error;
use super::turn::start::first_prompt_system_prompt_append_for_codex_prompt;
use crate::app::test_support;
use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::domains::sessions::live_config::{
    normalized_key_rank, snapshot_to_record, NormalizedControlKind, SessionModelOption,
};
use crate::domains::sessions::{model::SessionRecord, store::SessionStore};
use crate::live::sessions::background_work::{BackgroundWorkOptions, BackgroundWorkRegistry};
use crate::live::sessions::driver::types::NativeSessionStartupDisposition;
use crate::live::sessions::handle::{LiveSessionExecutionSnapshot, LiveSessionHandle};
use crate::live::sessions::model::LaunchObservationInvalidator;
use crate::live::sessions::rendezvous::broker::{InteractionRendezvous, PermissionOutcome};
use crate::live::sessions::sink::{SessionEventSink, SessionEventSinkDebugSnapshot};
use crate::persistence::Db;
use agent_client_protocol as acp;
use anyharness_contract::v1::{
    HarnessLaunchControl, HarnessLaunchControlValue, HarnessLaunchModel, InteractionKind,
    NormalizedSessionControl, NormalizedSessionControlValue, NormalizedSessionControls,
    PendingInteractionPayloadSummary, PendingInteractionSource, PendingInteractionSummary,
    PermissionInteractionOption, PermissionInteractionOptionKind, SessionEventEnvelope,
    SessionExecutionPhase, SessionLiveConfigCurrent, SessionLiveConfigSnapshot, StopReason,
};
use tokio::sync::{broadcast, mpsc, Mutex};

mod conditional_cancel;
mod config;
mod config_direct_setter;
mod config_launch_intent;
mod config_restore;
mod config_variants;
mod domain_ops;
mod idle_reap;
mod notifications;
mod prompt;
mod queue;
mod shutdown;
mod workspace_stop;

async fn actor_exit_test_context(
    pending_interaction: Option<PendingInteractionSummary>,
) -> (
    SessionStore,
    Arc<Mutex<SessionEventSink>>,
    Arc<InteractionRendezvous>,
    Arc<LiveSessionHandle>,
) {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");

    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_contexts: None,
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
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
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
    let mut execution = LiveSessionExecutionSnapshot::new(phase.clone());
    let interaction_broker = Arc::new(InteractionRendezvous::new());
    if let Some(pending_interaction) = pending_interaction {
        let request_id = pending_interaction.request_id.clone();
        execution.pending_interactions.push(pending_interaction);
        interaction_broker
            .insert_pending_for_test(
                "session-1",
                &request_id,
                vec![acp::schema::PermissionOption::new(
                    acp::schema::PermissionOptionId::new("allow"),
                    "Allow",
                    acp::schema::PermissionOptionKind::AllowOnce,
                )],
            )
            .await;
    }

    let handle = Arc::new(LiveSessionHandle::new(
        "session-1",
        command_tx,
        event_tx.clone(),
        Some("native-1".to_string()),
        phase,
    ));
    *handle.execution.write().await = execution;

    let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx,
        Arc::new(store.clone()),
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

fn test_background_work_registry(store: &SessionStore) -> BackgroundWorkRegistry {
    let (updates_tx, _updates_rx) = mpsc::unbounded_channel();
    BackgroundWorkRegistry::new(
        "session-1".to_string(),
        "claude".to_string(),
        Arc::new(store.clone()),
        updates_tx,
        BackgroundWorkOptions::default(),
    )
}
