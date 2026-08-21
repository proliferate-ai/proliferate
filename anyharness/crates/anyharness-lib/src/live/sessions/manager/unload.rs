//! Non-terminal actor retirement: the `Unload` disposition and the wait that
//! proves the exact registered handle has left the live map.
//!
//! Split out of `manager/mod.rs` so the idle reaper's conditional variant
//! (`manager/reaper.rs::unload_session_if_still_idle`) shares the wait instead
//! of duplicating it.

use std::sync::Arc;

use tokio::time::Instant;

use super::LiveSessionManager;
use crate::live::sessions::handle::LiveSessionHandle;

#[cfg(not(test))]
const UNLOAD_EXIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
#[cfg(test)]
const UNLOAD_EXIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

fn unload_timed_out() -> anyhow::Error {
    anyhow::anyhow!(
        "non-terminal actor unload timed out after {}s",
        UNLOAD_EXIT_TIMEOUT.as_secs()
    )
}

impl LiveSessionManager {
    /// Retire one actor without changing the durable session lifecycle. The
    /// actor itself bounds ACP cancellation and finalizes any partial turn;
    /// this method waits for the exact registered handle to leave the live
    /// map so a subsequent resume cannot race actor retirement.
    pub(crate) async fn unload_session_nonterminal(&self, session_id: &str) -> anyhow::Result<()> {
        let Some(handle) = self.get_handle(session_id).await else {
            return Ok(());
        };
        // One deadline covers acceptance AND retirement, exactly as the single
        // enclosing timeout this was factored out of did.
        let deadline = Instant::now() + UNLOAD_EXIT_TIMEOUT;

        let accepted = tokio::time::timeout_at(deadline, handle.unload_nonterminal())
            .await
            .map_err(|_| unload_timed_out())?;
        if let Err(error) = accepted {
            // A dead command channel means this exact actor is already
            // unavailable. Remove only its stale map entry; never evict a
            // newer actor that might have been installed concurrently.
            let mut sessions = self.live_sessions.write().await;
            if matches!(sessions.get(session_id), Some(current) if Arc::ptr_eq(current, &handle)) {
                sessions.remove(session_id);
            }
            tracing::debug!(session_id, error = %error, "non-terminal unload found unavailable actor");
            return Ok(());
        }

        self.await_actor_retirement_by(session_id, &handle, deadline)
            .await
    }

    /// Wait for this exact handle to leave the live map, which is what makes a
    /// retirement observable to a caller that may immediately resume the
    /// session.
    pub(crate) async fn await_actor_retirement(
        &self,
        session_id: &str,
        handle: &Arc<LiveSessionHandle>,
    ) -> anyhow::Result<()> {
        self.await_actor_retirement_by(session_id, handle, Instant::now() + UNLOAD_EXIT_TIMEOUT)
            .await
    }

    /// Never evicts a newer actor: the comparison is by pointer, so an actor
    /// installed while this one was exiting ends the wait without being
    /// mistaken for the retiring generation.
    async fn await_actor_retirement_by(
        &self,
        session_id: &str,
        handle: &Arc<LiveSessionHandle>,
        deadline: Instant,
    ) -> anyhow::Result<()> {
        tokio::time::timeout_at(deadline, async {
            loop {
                let retired = {
                    let sessions = self.live_sessions.read().await;
                    !matches!(sessions.get(session_id), Some(current) if Arc::ptr_eq(current, handle))
                };
                if retired {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_| unload_timed_out())
    }
}
