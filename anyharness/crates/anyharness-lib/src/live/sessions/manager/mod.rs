use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{watch, RwLock};

use super::rendezvous::broker::{
    InteractionRendezvous, ResolveInteractionError as BrokerResolveInteractionError,
};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::ActorCapabilities;

mod replay;
mod runtime_events;
mod startup;

#[cfg(test)]
mod tests;

type StartupReadinessState = Option<Result<String, String>>;

pub struct LiveSessionManager {
    live_sessions: Arc<RwLock<HashMap<String, Arc<LiveSessionHandle>>>>,
    pending_startups: Arc<RwLock<HashMap<String, watch::Receiver<StartupReadinessState>>>>,
    interaction_broker: Arc<InteractionRendezvous>,
    /// The never-varies capability set every actor runs against; wired once
    /// at construction.
    caps: ActorCapabilities,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RevealMcpElicitationUrlError {
    NotFound,
    KindMismatch,
    NotMcpUrlElicitation,
    InvalidMcpFieldValue,
}

impl From<BrokerResolveInteractionError> for RevealMcpElicitationUrlError {
    fn from(error: BrokerResolveInteractionError) -> Self {
        match error {
            BrokerResolveInteractionError::NotFound => Self::NotFound,
            BrokerResolveInteractionError::KindMismatch => Self::KindMismatch,
            BrokerResolveInteractionError::NotMcpUrlElicitation => Self::NotMcpUrlElicitation,
            BrokerResolveInteractionError::InvalidOptionId
            | BrokerResolveInteractionError::InvalidQuestionId
            | BrokerResolveInteractionError::DuplicateQuestionAnswer
            | BrokerResolveInteractionError::MissingQuestionAnswer
            | BrokerResolveInteractionError::InvalidSelectedOptionLabel
            | BrokerResolveInteractionError::InvalidMcpFieldId
            | BrokerResolveInteractionError::DuplicateMcpField
            | BrokerResolveInteractionError::MissingMcpField
            | BrokerResolveInteractionError::InvalidMcpFieldValue => Self::InvalidMcpFieldValue,
        }
    }
}

impl LiveSessionManager {
    pub fn new(caps: ActorCapabilities) -> Self {
        let interaction_broker = Arc::new(InteractionRendezvous::new());
        Self {
            live_sessions: Arc::new(RwLock::new(HashMap::new())),
            pending_startups: Arc::new(RwLock::new(HashMap::new())),
            interaction_broker,
            caps,
        }
    }

    pub(crate) async fn reveal_mcp_elicitation_url(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<String, RevealMcpElicitationUrlError> {
        self.interaction_broker
            .reveal_mcp_elicitation_url(session_id, request_id)
            .await
            .map_err(RevealMcpElicitationUrlError::from)
    }

    pub async fn get_handle(&self, session_id: &str) -> Option<Arc<LiveSessionHandle>> {
        let sessions = self.live_sessions.read().await;
        sessions.get(session_id).cloned()
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.live_sessions.write().await;
        sessions.remove(session_id);
        self.pending_startups.write().await.remove(session_id);
    }

    /// Synchronous variant for mobility install/export code that runs inside a
    /// blocking task. Dropping the handle forces the next prompt to start a
    /// fresh native agent with the destination workspace path.
    pub fn remove_session_blocking(&self, session_id: &str) {
        self.live_sessions.blocking_write().remove(session_id);
        self.pending_startups.blocking_write().remove(session_id);
    }
}

impl Clone for LiveSessionManager {
    fn clone(&self) -> Self {
        Self {
            live_sessions: self.live_sessions.clone(),
            pending_startups: self.pending_startups.clone(),
            interaction_broker: self.interaction_broker.clone(),
            caps: self.caps.clone(),
        }
    }
}
