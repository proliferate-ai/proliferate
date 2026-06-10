use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{SessionActionCapabilities, SessionEventEnvelope};
use tokio::sync::{broadcast, oneshot, Mutex};

use crate::domains::sessions::live_config::SessionModelOption;
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::live::sessions::actor::config::selection::find_select_option_by_purpose;
use crate::live::sessions::actor::config::types::{ConfigPurpose, PersistedSessionConfigState};
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::background_work::BackgroundWorkRegistry;
use crate::live::sessions::driver::types::NativeSessionStartupState;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::{
    ActorCapabilities, SessionHooks, SessionLaunch, SystemPromptAppends,
};
use crate::live::sessions::rendezvous::broker::InteractionRendezvous;
use crate::live::sessions::sink::SessionEventSink;

pub struct SessionActorConfig {
    /// Everything describing THIS launch (session row, agent, env, startup).
    pub launch: SessionLaunch,
    /// The never-varies durable capabilities + product reactors.
    pub caps: ActorCapabilities,
    /// Per-call powers (turn-finish callback, exit callback, latency context).
    pub hooks: SessionHooks,
    pub interaction_broker: Arc<InteractionRendezvous>,
    pub event_tx: broadcast::Sender<SessionEventEnvelope>,
}

/// The session actor: one running agent process, its ACP connection, and all
/// loop-owned conversation state. Constructed by [`SessionActor::start`]
/// (startup.rs) and driven by [`SessionActor::run`] (run.rs). The three
/// receivers (commands, notifications, background work) deliberately stay OUT
/// of the struct — they are threaded through `run`/`run_idle`/`run_turn` as
/// parameters so the inner selects can borrow them alongside `&mut self`.
pub(in crate::live::sessions::actor) struct SessionActor {
    // ── identity (from launch, immutable) ──
    pub(in crate::live::sessions::actor) session_id: String,
    pub(in crate::live::sessions::actor) workspace_id: String,
    pub(in crate::live::sessions::actor) agent_kind: String,
    pub(in crate::live::sessions::actor) workspace_path: PathBuf,
    pub(in crate::live::sessions::actor) mcp_servers: Vec<SessionMcpServer>,
    pub(in crate::live::sessions::actor) prompts: SystemPromptAppends,

    // ── conversation state (loop-owned) ──
    // KEEP Arc<Mutex<…>>: the inbound door (driver/inbound) shares this sink.
    pub(in crate::live::sessions::actor) event_sink: Arc<Mutex<SessionEventSink>>,
    pub(in crate::live::sessions::actor) background_work_registry: BackgroundWorkRegistry,
    pub(in crate::live::sessions::actor) resume_replay_filter: ResumeReplayFilter,
    pub(in crate::live::sessions::actor) persisted_config_state: PersistedSessionConfigState,
    pub(in crate::live::sessions::actor) startup_state: SessionStartupState,
    pub(in crate::live::sessions::actor) native_session_id: String,
    pub(in crate::live::sessions::actor) action_capabilities: SessionActionCapabilities,
    pub(in crate::live::sessions::actor) supports_native_close: bool,

    // ── wiring (set at spawn/startup, never reassigned) ──
    pub(in crate::live::sessions::actor) conn: acp::ConnectionTo<acp::Agent>,
    pub(in crate::live::sessions::actor) caps: ActorCapabilities,
    pub(in crate::live::sessions::actor) hooks: SessionHooks,
    pub(in crate::live::sessions::actor) interaction_broker: Arc<InteractionRendezvous>,
    pub(in crate::live::sessions::actor) handle: Arc<LiveSessionHandle>,
    /// Dropping this shuts down the ACP connection task.
    #[allow(dead_code)]
    pub(in crate::live::sessions::actor) _acp_shutdown: oneshot::Sender<()>,
    /// The agent process guard; dropped last when the actor exits.
    pub(in crate::live::sessions::actor) child: tokio::process::Child,
}

#[derive(Debug, Clone)]
pub(in crate::live::sessions) struct SessionStartupState {
    pub(in crate::live::sessions) current_mode_id: Option<String>,
    pub(in crate::live::sessions) legacy_mode_state:
        Option<crate::domains::sessions::live_config::LegacyModeState>,
    pub(in crate::live::sessions) config_options: Vec<acp::schema::SessionConfigOption>,
    pub(in crate::live::sessions) current_model_id: Option<String>,
    pub(in crate::live::sessions) available_models: Vec<SessionModelOption>,
    pub(in crate::live::sessions) prompt_capabilities: anyharness_contract::v1::PromptCapabilities,
}

impl From<NativeSessionStartupState> for SessionStartupState {
    fn from(native: NativeSessionStartupState) -> Self {
        Self {
            current_mode_id: native.current_mode_id,
            legacy_mode_state: native.legacy_mode_state,
            config_options: native.config_options,
            current_model_id: native.current_model_id,
            available_models: native.available_models,
            prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
        }
    }
}

impl SessionStartupState {
    pub(in crate::live::sessions) fn set_current_mode_id(
        &mut self,
        current_mode_id: impl Into<String>,
    ) {
        let current_mode_id = current_mode_id.into();
        self.current_mode_id = Some(current_mode_id.clone());
        if let Some(legacy_mode_state) = self.legacy_mode_state.as_mut() {
            legacy_mode_state.current_mode_id = current_mode_id;
        }
    }

    pub(in crate::live::sessions) fn has_legacy_mode_control(&self) -> bool {
        self.legacy_mode_state
            .as_ref()
            .map(|state| !state.available_modes.is_empty())
            .unwrap_or(false)
    }

    pub(in crate::live::sessions) fn has_direct_model_control(&self) -> bool {
        self.current_model_id.is_some() || !self.available_models.is_empty()
    }

    pub(in crate::live::sessions) fn has_raw_or_legacy_mode_control(&self) -> bool {
        self.has_legacy_mode_control()
            || find_select_option_by_purpose(&self.config_options, ConfigPurpose::Mode).is_some()
    }

    pub(in crate::live::sessions) fn legacy_mode_contains_value(
        &self,
        desired_mode_id: &str,
    ) -> bool {
        self.legacy_mode_state
            .as_ref()
            .map(|state| {
                state
                    .available_modes
                    .iter()
                    .any(|mode| mode.id == desired_mode_id)
            })
            .unwrap_or(false)
    }
}
