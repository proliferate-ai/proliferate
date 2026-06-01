use std::sync::Arc;

use super::LiveSessionManager;
use crate::sessions::runtime_event::{
    RuntimeEventInjectionError, RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};
use crate::sessions::store::SessionStore;

impl LiveSessionManager {
    #[cfg_attr(not(test), allow(dead_code))]
    /// Inject a runtime-owned event into a session.
    ///
    /// If the live actor dies between handle lookup and command delivery, this
    /// transparently removes the stale handle and appends the event offline
    /// under the same start/inject critical section. `ActorUnavailable` is
    /// therefore terminal from the caller's perspective, not a normal retry
    /// signal.
    pub(crate) async fn emit_runtime_event(
        &self,
        session_id: &str,
        session_store: SessionStore,
        event: RuntimeInjectedSessionEvent,
    ) -> RuntimeEventInjectionResult {
        loop {
            let handle = {
                let sessions = self.live_sessions.write().await;
                if let Some(handle) = sessions.get(session_id) {
                    handle.clone()
                } else {
                    return append_offline_runtime_event(session_id, &session_store, event);
                }
            };

            let result = handle.inject_runtime_event(event.clone()).await;
            match result {
                Ok(result) => return Ok(result),
                Err(RuntimeEventInjectionError::ActorUnavailable) => {
                    let mut sessions = self.live_sessions.write().await;
                    match sessions.get(session_id) {
                        Some(current) if Arc::ptr_eq(current, &handle) => {
                            sessions.remove(session_id);
                            return append_offline_runtime_event(session_id, &session_store, event);
                        }
                        None => {
                            return append_offline_runtime_event(session_id, &session_store, event);
                        }
                        Some(_) => continue,
                    }
                }
                Err(error) => return Err(error),
            }
        }
    }
}

fn append_offline_runtime_event(
    session_id: &str,
    session_store: &SessionStore,
    event: RuntimeInjectedSessionEvent,
) -> RuntimeEventInjectionResult {
    let touch_session_activity = event.updates_session_activity_at();
    session_store
        .append_event_with_next_seq(
            session_id,
            event.into_session_event(),
            touch_session_activity,
        )
        .map_err(|error| RuntimeEventInjectionError::PersistenceFailed(error.to_string()))
}
