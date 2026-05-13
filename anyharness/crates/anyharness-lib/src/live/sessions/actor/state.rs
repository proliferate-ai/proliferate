use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionEventEnvelope;
use tokio::sync::broadcast;

use crate::acp::permission_broker::InteractionBroker;
use crate::domains::agents::model::ResolvedAgent;
use crate::domains::plans::service::PlanService;
use crate::domains::reviews::service::ReviewService;
use crate::live::sessions::actor::config::selection::find_select_option_by_purpose;
use crate::live::sessions::actor::config::types::ConfigPurpose;
use crate::live::sessions::actor::turn::types::SessionTurnFinishResult;
use crate::live::sessions::connection::types::NativeSessionStartupState;
use crate::observability::latency::LatencyRequestContext;
use crate::sessions::attachment_storage::PromptAttachmentStorage;
use crate::sessions::mcp_bindings::model::SessionMcpServer;
use crate::sessions::model::SessionRecord;
use crate::sessions::store::SessionStore;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStartupStrategy {
    Fresh,
    ResumeSeqFreshNative,
    LoadNative(String),
    LoadNativeNoFallback(String),
    ForkFromNative { parent_native_session_id: String },
}

impl SessionStartupStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::ResumeSeqFreshNative => "resume_seq_fresh_native",
            Self::LoadNative(_) => "load_native",
            Self::LoadNativeNoFallback(_) => "load_native_no_fallback",
            Self::ForkFromNative { .. } => "fork_from_native",
        }
    }

    pub fn resumes_durable_history(&self) -> bool {
        !matches!(self, Self::Fresh)
    }

    pub(in crate::live::sessions) fn allows_missing_load_fallback(&self) -> bool {
        matches!(self, Self::LoadNative(_))
    }
}

pub struct SessionActorConfig {
    pub session: SessionRecord,
    pub agent: ResolvedAgent,
    pub workspace_path: std::path::PathBuf,
    pub workspace_env: std::collections::BTreeMap<String, String>,
    pub session_launch_env: std::collections::BTreeMap<String, String>,
    pub interaction_broker: Arc<InteractionBroker>,
    pub plan_service: Arc<PlanService>,
    pub review_service: Option<Arc<ReviewService>>,
    pub event_tx: broadcast::Sender<SessionEventEnvelope>,
    pub session_store: SessionStore,
    pub attachment_storage: PromptAttachmentStorage,
    pub mcp_servers: Vec<SessionMcpServer>,
    pub startup_strategy: SessionStartupStrategy,
    pub last_seq: i64,
    pub system_prompt_append: Option<String>,
    pub first_prompt_system_prompt_append: Option<String>,
    pub on_turn_finish: Option<Arc<dyn Fn(SessionTurnFinishResult) + Send + Sync + 'static>>,
    pub latency: Option<LatencyRequestContext>,
    /// Called after the actor loop exits (normal or error). The bool indicates
    /// whether the actor exited with an error (true = errored).
    pub on_exit: Option<Box<dyn FnOnce(bool) + Send + 'static>>,
}

#[derive(Debug, Clone)]
pub(in crate::live::sessions) struct SessionStartupState {
    pub(in crate::live::sessions) current_mode_id: Option<String>,
    pub(in crate::live::sessions) legacy_mode_state:
        Option<crate::sessions::live_config::LegacyModeState>,
    pub(in crate::live::sessions) config_options: Vec<acp::SessionConfigOption>,
    pub(in crate::live::sessions) current_model_id: Option<String>,
    pub(in crate::live::sessions) available_model_ids: Vec<String>,
    pub(in crate::live::sessions) prompt_capabilities: anyharness_contract::v1::PromptCapabilities,
}

impl From<NativeSessionStartupState> for SessionStartupState {
    fn from(native: NativeSessionStartupState) -> Self {
        Self {
            current_mode_id: native.current_mode_id,
            legacy_mode_state: native.legacy_mode_state,
            config_options: native.config_options,
            current_model_id: native.current_model_id,
            available_model_ids: native.available_model_ids,
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
