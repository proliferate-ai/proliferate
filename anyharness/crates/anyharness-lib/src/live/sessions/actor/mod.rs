pub mod background_work;
pub mod command;
pub mod config;
pub mod event_loop;
pub mod fork;
pub mod interactions;
pub mod notifications;
pub mod shutdown;
pub mod startup;
pub mod state;
pub mod turn;

pub(in crate::live::sessions::actor) use std::fmt;
pub(in crate::live::sessions::actor) use std::sync::atomic::{AtomicBool, Ordering};
pub(in crate::live::sessions::actor) use std::sync::Arc;
pub(in crate::live::sessions::actor) use std::time::{Duration, Instant};

pub(in crate::live::sessions::actor) use agent_client_protocol as acp;
pub(in crate::live::sessions::actor) use agent_client_protocol::Agent;
pub(in crate::live::sessions::actor) use tokio::sync::{broadcast, mpsc, oneshot, Mutex, RwLock};
pub(in crate::live::sessions::actor) use tokio_util::compat::{
    TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt,
};

pub(in crate::live::sessions::actor) use crate::acp::background_work::{
    BackgroundWorkOptions, BackgroundWorkRegistry, BackgroundWorkUpdate,
};
pub(in crate::live::sessions::actor) use crate::acp::event_sink::{
    AcpChunkPayload, AcpToolPayload, CompletedAssistantMessage, SessionEventSink,
    SessionEventSinkDebugSnapshot,
};
pub(in crate::live::sessions::actor) use crate::acp::mcp_elicitation::McpElicitationOutcome;
pub(in crate::live::sessions::actor) use crate::acp::permission_broker::{
    InteractionBroker, InteractionBrokerOutcome, InteractionCancelOutcome, PermissionDecision,
    PermissionOutcome, ResolveInteractionError, UserInputOutcome,
};
pub(in crate::live::sessions::actor) use crate::acp::persistence_sanitizer::sanitize_raw_notification_for_sqlite;
pub(in crate::live::sessions::actor) use crate::acp::provider_errors::{
    classify_provider_rate_limit_error, PROVIDER_RATE_LIMIT_CODE,
};
pub(in crate::live::sessions::actor) use crate::acp::runtime_client::RuntimeClient;
pub(in crate::live::sessions::actor) use crate::domains::agents::model::{
    AgentKind, ResolvedAgent,
};
pub(in crate::live::sessions::actor) use crate::domains::plans::model::{NewPlan, PlanRecord};
pub(in crate::live::sessions::actor) use crate::domains::plans::service::{
    PlanCreateError, PlanDecisionError, PlanService,
};
pub(in crate::live::sessions::actor) use crate::domains::reviews::service::ReviewService;
pub(in crate::live::sessions::actor) use crate::observability::latency::{
    latency_trace_fields, LatencyRequestContext,
};
pub(in crate::live::sessions::actor) use crate::sessions::attachment_storage::PromptAttachmentStorage;
pub(in crate::live::sessions::actor) use crate::sessions::extensions::SessionTurnOutcome;
pub(in crate::live::sessions::actor) use crate::sessions::live_config::{
    build_live_config_snapshot, normalized_key_rank, option_matches_key, snapshot_from_record,
    snapshot_to_record, NormalizedControlKind, LEGACY_MODE_COMPAT_CONFIG_ID,
};
pub(in crate::live::sessions::actor) use crate::sessions::mcp_bindings::acp::to_acp_servers;
pub(in crate::live::sessions::actor) use crate::sessions::mcp_bindings::model::SessionMcpServer;
pub(in crate::live::sessions::actor) use crate::sessions::model::{
    serialize_action_capabilities, PendingConfigChangeRecord, PromptAttachmentRecord,
    PromptAttachmentState, SessionRecord,
};
pub(in crate::live::sessions::actor) use crate::sessions::prompt::{
    capabilities_from_acp, PromptPayload,
};
pub(in crate::live::sessions::actor) use crate::sessions::runtime_event::{
    RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};
pub(in crate::live::sessions::actor) use crate::sessions::store::SessionStore;
pub(in crate::live::sessions::actor) use anyharness_contract::v1::{
    AvailableCommandsUpdatePayload, ConfigApplyState, ConfigOptionUpdatePayload,
    CurrentModeUpdatePayload, ErrorEventDetails, InteractionKind, InteractionOutcome,
    McpElicitationSubmittedField, NormalizedSessionControl, PendingPromptAddedPayload,
    PendingPromptRemovalReason, PendingPromptRemovedPayload, PendingPromptUpdatedPayload,
    ProposedPlanDecisionState, ProposedPlanNativeResolutionState, SessionActionCapabilities,
    SessionEndReason, SessionEventEnvelope, SessionExecutionPhase, SessionInfoUpdatePayload,
    SessionLiveConfigSnapshot, SessionStateUpdatePayload, StopReason, UsageUpdatePayload,
    UserInputSubmittedAnswer,
};

pub(in crate::live::sessions::actor) use crate::live::sessions::connection::native_session::start_native_session;
pub(in crate::live::sessions::actor) use crate::live::sessions::connection::process::spawn_agent_process;
pub(in crate::live::sessions::actor) use crate::live::sessions::connection::shutdown::close_native_session;
pub(in crate::live::sessions::actor) use crate::live::sessions::connection::start::initialize_connection;
pub(in crate::live::sessions::actor) use crate::live::sessions::connection::types::{
    NativeSessionStartupDisposition, SessionStartupState, SessionStartupStrategy,
};
pub(in crate::live::sessions::actor) use crate::live::sessions::handle::{
    LiveSessionExecutionSnapshot, LiveSessionHandle,
};

pub(in crate::live::sessions::actor) use background_work::*;
pub(in crate::live::sessions::actor) use command::*;
pub(in crate::live::sessions::actor) use config::apply::*;
pub(in crate::live::sessions::actor) use config::handle::*;
pub(in crate::live::sessions::actor) use config::persist::*;
pub(in crate::live::sessions::actor) use config::queue::*;
pub(in crate::live::sessions::actor) use config::selection::*;
pub(in crate::live::sessions::actor) use config::types::*;
pub(in crate::live::sessions::actor) use fork::handle::*;
pub(in crate::live::sessions::actor) use fork::policy::*;
pub(in crate::live::sessions::actor) use interactions::cleanup::*;
pub(in crate::live::sessions::actor) use interactions::handle::*;
pub(in crate::live::sessions::actor) use notifications::dispatch::*;
pub(in crate::live::sessions::actor) use notifications::handle::*;
pub(in crate::live::sessions::actor) use notifications::plans::*;
pub(in crate::live::sessions::actor) use notifications::replay_filter::*;
pub(in crate::live::sessions::actor) use notifications::types::*;
pub(in crate::live::sessions::actor) use shutdown::cleanup::*;
pub(in crate::live::sessions::actor) use shutdown::handle::*;
pub(in crate::live::sessions::actor) use shutdown::persist::*;
pub(in crate::live::sessions::actor) use shutdown::types::*;
pub(in crate::live::sessions::actor) use startup::*;
pub(in crate::live::sessions::actor) use state::*;
pub(in crate::live::sessions::actor) use turn::active::*;
pub(in crate::live::sessions::actor) use turn::diagnostics::*;
pub(in crate::live::sessions::actor) use turn::finish::*;
pub(in crate::live::sessions::actor) use turn::handle::*;
pub(in crate::live::sessions::actor) use turn::queue::*;
pub(in crate::live::sessions::actor) use turn::start::*;
pub(in crate::live::sessions::actor) use turn::types::*;

#[cfg(test)]
mod tests;
