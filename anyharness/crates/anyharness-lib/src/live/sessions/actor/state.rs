use crate::live::sessions::actor::*;
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
