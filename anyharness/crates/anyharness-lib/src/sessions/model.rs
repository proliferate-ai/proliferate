use anyharness_contract::v1;

#[derive(Debug, Clone)]
pub struct SessionRecord {
    pub id: String,
    pub workspace_id: String,
    pub agent_kind: String,
    pub native_session_id: Option<String>,
    pub requested_model_id: Option<String>,
    pub current_model_id: Option<String>,
    pub requested_mode_id: Option<String>,
    pub current_mode_id: Option<String>,
    pub title: Option<String>,
    pub thinking_level_id: Option<String>,
    pub thinking_budget_tokens: Option<u32>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_prompt_at: Option<String>,
    pub closed_at: Option<String>,
    pub dismissed_at: Option<String>,
}

impl SessionRecord {
    pub fn to_contract(&self) -> v1::Session {
        self.to_contract_with_details(None, None)
    }

    pub fn to_contract_with_live_config(
        &self,
        live_config: Option<v1::SessionLiveConfigSnapshot>,
    ) -> v1::Session {
        self.to_contract_with_details(live_config, None)
    }

    pub fn to_contract_with_details(
        &self,
        live_config: Option<v1::SessionLiveConfigSnapshot>,
        execution_summary: Option<v1::SessionExecutionSummary>,
    ) -> v1::Session {
        v1::Session {
            id: self.id.clone(),
            workspace_id: self.workspace_id.clone(),
            agent_kind: self.agent_kind.clone(),
            native_session_id: self.native_session_id.clone(),
            model_id: self.current_model_id.clone(),
            requested_model_id: self.requested_model_id.clone(),
            mode_id: self.current_mode_id.clone(),
            requested_mode_id: self.requested_mode_id.clone(),
            title: self.title.clone(),
            live_config,
            execution_summary,
            status: parse_status(&self.status),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            last_prompt_at: self.last_prompt_at.clone(),
            closed_at: self.closed_at.clone(),
            dismissed_at: self.dismissed_at.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionLiveConfigSnapshotRecord {
    pub session_id: String,
    pub source_seq: i64,
    pub raw_config_options_json: String,
    pub normalized_controls_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct PendingConfigChangeRecord {
    pub session_id: String,
    pub config_id: String,
    pub value: String,
    pub queued_at: String,
}

fn parse_status(s: &str) -> v1::SessionStatus {
    match s {
        "starting" => v1::SessionStatus::Starting,
        "idle" => v1::SessionStatus::Idle,
        "running" => v1::SessionStatus::Running,
        "completed" => v1::SessionStatus::Completed,
        "errored" => v1::SessionStatus::Errored,
        "closed" => v1::SessionStatus::Closed,
        _ => v1::SessionStatus::Errored,
    }
}

#[derive(Debug, Clone)]
pub struct SessionEventRecord {
    pub id: i64,
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    pub event_type: String,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub payload_json: String,
}

#[derive(Debug, Clone)]
pub struct SessionRawNotificationRecord {
    pub id: i64,
    pub session_id: String,
    pub seq: i64,
    pub timestamp: String,
    pub notification_kind: String,
    pub payload_json: String,
}
