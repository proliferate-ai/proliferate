use std::sync::Arc;

use anyharness_contract::v1::SessionEventEnvelope;
use tokio::sync::broadcast;

use super::LiveSessionManager;
use crate::domains::sessions::model::SessionRecord;
use crate::live::sessions::actor::spawn::ActorReadyResult;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::replay::{spawn_replay_actor, ReplayActorConfig};

impl LiveSessionManager {
    pub async fn start_replay_session(
        &self,
        session: SessionRecord,
        events: Vec<SessionEventEnvelope>,
        speed: f32,
        last_seq: i64,
    ) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
        let session_id = session.id.clone();
        let mut sessions = self.live_sessions.write().await;
        if let Some(existing) = sessions.get(&session_id) {
            return Ok((
                existing.clone(),
                ActorReadyResult {
                    native_session_id: existing
                        .native_session_id()
                        .or(session.native_session_id)
                        .unwrap_or_default(),
                },
            ));
        }

        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(4096);
        let live_sessions = self.live_sessions.clone();
        let exit_session_id = session_id.clone();
        let exit_store = self.caps.state.clone();
        let on_exit: Box<dyn FnOnce(bool) + Send + 'static> = Box::new(move |errored| {
            live_sessions.blocking_write().remove(&exit_session_id);
            if errored {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = exit_store.update_status(&exit_session_id, "errored", &now);
            }
        });

        let config = ReplayActorConfig {
            session,
            events,
            speed,
            event_tx,
            state: self.caps.state.clone(),
            event_persist: self.caps.events.clone(),
            last_seq,
            on_exit: Some(on_exit),
        };
        let (handle, ready) = spawn_replay_actor(config)?;
        sessions.insert(session_id, handle.clone());
        Ok((handle, ready))
    }
}
