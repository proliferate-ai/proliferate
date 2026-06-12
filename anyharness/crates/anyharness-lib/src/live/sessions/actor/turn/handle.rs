use std::sync::Arc;

use agent_client_protocol as acp;
use tokio::sync::{mpsc, Mutex};

use crate::domains::agents::model::AgentKind;
use crate::live::sessions::actor::command::SessionCommand;
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::shutdown::types::ActorExitDisposition;
use crate::live::sessions::actor::state::{SessionActorConfig, SessionStartupState};
use crate::live::sessions::actor::turn::active::{
    handle_active_prompt, ActivePromptContext, ActivePromptRequest,
};
use crate::live::sessions::background_work::{BackgroundWorkRegistry, BackgroundWorkUpdate};
use crate::live::sessions::sink::SessionEventSink;
use crate::live::sessions::handle::LiveSessionHandle;

pub(in crate::live::sessions::actor) struct IdlePromptContext<'a> {
    pub config: &'a SessionActorConfig,
    pub conn: &'a acp::ConnectionTo<acp::Agent>,
    pub native_session_id: &'a str,
    pub command_rx: &'a mut mpsc::Receiver<SessionCommand>,
    pub notification_rx: &'a mut mpsc::UnboundedReceiver<acp::schema::SessionNotification>,
    pub background_work_rx: &'a mut mpsc::UnboundedReceiver<BackgroundWorkUpdate>,
    pub background_work_registry: &'a mut BackgroundWorkRegistry,
    pub event_sink: &'a Arc<Mutex<SessionEventSink>>,
    pub persisted_config_state: &'a mut PersistedSessionConfigState,
    pub startup_state: &'a mut SessionStartupState,
    pub resume_replay_filter: &'a mut ResumeReplayFilter,
    pub handle: &'a Arc<LiveSessionHandle>,
}

pub(in crate::live::sessions::actor) async fn handle_idle_prompt_command(
    context: IdlePromptContext<'_>,
    request: ActivePromptRequest,
) -> Option<ActorExitDisposition> {
    let IdlePromptContext {
        config,
        conn,
        native_session_id,
        command_rx,
        notification_rx,
        background_work_rx,
        background_work_registry,
        event_sink,
        persisted_config_state,
        startup_state,
        resume_replay_filter,
        handle,
    } = context;

    handle_active_prompt(
        ActivePromptContext {
            config,
            conn,
            native_session_id,
            command_rx,
            notification_rx,
            background_work_rx,
            background_work_registry,
            event_sink,
            persisted_config_state,
            startup_state,
            resume_replay_filter,
            handle,
        },
        request,
    )
    .await
}

pub(in crate::live::sessions::actor) fn first_prompt_system_prompt_append_for_codex_prompt<'a>(
    source_agent_kind: &str,
    first_prompt_system_prompt_append: Option<&'a str>,
    has_turn_started: bool,
) -> Option<&'a str> {
    if source_agent_kind != AgentKind::Codex.as_str() || has_turn_started {
        return None;
    }

    let append = first_prompt_system_prompt_append?.trim();
    if append.is_empty() {
        return None;
    }
    Some(append)
}
