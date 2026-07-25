//! `LoopSchedulerExtension` — the runtime scheduler for codex-emulated
//! loops (spec §2.7) plus the cap guard for every loop.
//!
//! Emulated loops have no native substrate: this [`SessionExtension`] owns
//! their timers. Fires happen ONLY at idle (never mid-turn); missed fires
//! coalesce to one (an overdue loop fires once at the next arm, then
//! re-schedules from now). The timer re-arms on session launch, on every
//! finished turn, and whenever the runtime mutates loop state.
//!
//! Native (claude) loops fire harness-side; here we only enforce caps: when
//! `max_fires`/`max_wall_secs` is exceeded the staged clear reason is
//! recorded and the sidecar LoopPort clear is issued — the mirror follows
//! through the ordinary `loop_cleared` ingest.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyharness_contract::v1::LoopStatus;

use super::model::LoopRecord;
use super::ops::{EmulatedLoopFireOp, EmulatedLoopFireOpOutput};
use super::runtime::LOOP_CLEAR_EXT_METHOD;
use super::service::{LoopService, LOOP_CLEAR_REASON_MAX_FIRES, LOOP_CLEAR_REASON_MAX_WALL};
use crate::domains::sessions::extensions::{
    SessionClosingActions, SessionClosingContext, SessionExtension, SessionLaunchContext,
    SessionLaunchExtras, SessionTurnFinishedContext,
};
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
use crate::live::sessions::{LiveSessionHandle, LiveSessionManager};

pub struct LoopSchedulerExtension {
    loop_service: Arc<LoopService>,
    acp_manager: LiveSessionManager,
    timers: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

impl LoopSchedulerExtension {
    pub fn new(loop_service: Arc<LoopService>, acp_manager: LiveSessionManager) -> Self {
        Self {
            loop_service,
            acp_manager,
            timers: Mutex::new(HashMap::new()),
        }
    }

    /// (Re-)arm the scheduler for a session: aborts any existing timer task
    /// and spawns a fresh one that walks due emulated loops until none are
    /// scheduled. Cheap to call; used at launch, at turn finish, and after
    /// runtime loop mutations.
    pub fn arm_session(&self, session_id: &str) {
        let loop_service = self.loop_service.clone();
        let acp_manager = self.acp_manager.clone();
        let session_id_owned = session_id.to_string();
        let task = tokio::spawn(async move {
            if let Err(error) =
                run_session_timer(loop_service, acp_manager, &session_id_owned).await
            {
                tracing::warn!(
                    session_id = %session_id_owned,
                    error = %error,
                    "loop scheduler timer failed"
                );
            }
        });
        let mut timers = self.timers.lock().expect("loop scheduler timers poisoned");
        if let Some(previous) = timers.insert(session_id.to_string(), task) {
            previous.abort();
        }
    }

    fn disarm_session(&self, session_id: &str) {
        let mut timers = self.timers.lock().expect("loop scheduler timers poisoned");
        if let Some(task) = timers.remove(session_id) {
            task.abort();
        }
    }

}

/// Cap guard for NATIVE loop mirrors: exceeded caps stage the typed clear
/// reason and issue the sidecar LoopPort clear; the mirror transitions when
/// the `loop_cleared` notification round-trips.
async fn enforce_native_loop_caps(
    loop_service: &Arc<LoopService>,
    acp_manager: &LiveSessionManager,
    session_id: &str,
) -> anyhow::Result<()> {
    let now = chrono::Utc::now();
    let exceeded: Vec<(LoopRecord, &'static str)> = loop_service
        .list_active_by_session(session_id)?
        .into_iter()
        .filter(|record| record.native)
        .filter_map(|record| cap_exceeded_reason(&record, now).map(|reason| (record, reason)))
        .collect();
    if exceeded.is_empty() {
        return Ok(());
    }
    let Some(handle) = acp_manager.get_handle(session_id).await else {
        return Ok(());
    };
    for (record, reason) in exceeded {
        let Some(native_loop_id) = record.native_loop_id.as_deref() else {
            continue;
        };
        loop_service.stage_cleared_reason(&record.id, reason)?;
        if let Err(error) = handle
            .call_agent_ext_method(
                LOOP_CLEAR_EXT_METHOD,
                serde_json::json!({ "loopId": native_loop_id }),
            )
            .await
        {
            tracing::warn!(
                session_id = %session_id,
                loop_id = %record.id,
                error = ?error,
                "failed to clear native loop after cap exhaustion"
            );
        }
    }
    Ok(())
}

async fn run_session_timer(
    loop_service: Arc<LoopService>,
    acp_manager: LiveSessionManager,
    session_id: &str,
) -> anyhow::Result<()> {
    loop {
        let Some((loop_id, next_fire_at)) = next_due_emulated(&loop_service, session_id)? else {
            return Ok(());
        };
        let now = chrono::Utc::now();
        if next_fire_at > now {
            let wait = (next_fire_at - now)
                .to_std()
                .unwrap_or(std::time::Duration::ZERO);
            tokio::time::sleep(wait).await;
        }
        let Some(handle) = acp_manager.get_handle(session_id).await else {
            // Session offline: stop; the launch-time arm resumes us.
            return Ok(());
        };
        if handle.is_busy() {
            // Never fire mid-turn; on_turn_finished re-arms and the overdue
            // loop coalesces to a single immediate fire.
            return Ok(());
        }
        fire_emulated_loop(&loop_service, &handle, session_id, &loop_id).await?;
    }
}

/// The soonest-due active emulated loop for the session.
fn next_due_emulated(
    loop_service: &LoopService,
    session_id: &str,
) -> anyhow::Result<Option<(String, chrono::DateTime<chrono::Utc>)>> {
    let mut soonest: Option<(String, chrono::DateTime<chrono::Utc>)> = None;
    for record in loop_service.list_active_by_session(session_id)? {
        if record.native || record.status != LoopStatus::Active {
            continue;
        }
        let Some(next_fire_at) = record
            .next_fire_at
            .as_deref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&chrono::Utc))
        else {
            continue;
        };
        if soonest
            .as_ref()
            .is_none_or(|(_, current)| next_fire_at < *current)
        {
            soonest = Some((record.id.clone(), next_fire_at));
        }
    }
    Ok(soonest)
}

async fn fire_emulated_loop(
    loop_service: &Arc<LoopService>,
    handle: &Arc<LiveSessionHandle>,
    session_id: &str,
    loop_id: &str,
) -> anyhow::Result<()> {
    let op = Box::new(EmulatedLoopFireOp {
        loop_service: loop_service.clone(),
        loop_id: loop_id.to_string(),
    });
    let reply = handle
        .run_domain_op(op)
        .await
        .map_err(|error| anyhow::anyhow!("loop fire op: {error:?}"))?;
    let output = reply
        .downcast::<EmulatedLoopFireOpOutput>()
        .map_err(|_| anyhow::anyhow!("loop fire op returned unexpected reply type"))?;
    let Some(record) = output.result? else {
        return Ok(());
    };
    tracing::info!(
        session_id = %session_id,
        loop_id = %record.id,
        fire_count = record.fire_count,
        "emulated loop fired; sending prompt"
    );
    let payload =
        PromptPayload::text(record.prompt.clone()).with_provenance(PromptProvenance::System {
            label: Some("loop".to_string()),
        });
    if let Err(error) = handle.send_prompt(payload, None).await {
        tracing::warn!(
            session_id = %session_id,
            loop_id = %record.id,
            error = ?error,
            "failed to send emulated loop prompt"
        );
    }
    Ok(())
}

pub(crate) fn cap_exceeded_reason(
    record: &LoopRecord,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<&'static str> {
    if record
        .max_fires
        .is_some_and(|max_fires| record.fire_count >= max_fires)
    {
        return Some(LOOP_CLEAR_REASON_MAX_FIRES);
    }
    let max_wall_secs = record.max_wall_secs?;
    let created_at = chrono::DateTime::parse_from_rfc3339(&record.created_at).ok()?;
    ((now - created_at.with_timezone(&chrono::Utc)).num_seconds() >= max_wall_secs)
        .then_some(LOOP_CLEAR_REASON_MAX_WALL)
}

impl SessionExtension for LoopSchedulerExtension {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        // Arm at launch so emulated loops survive session restarts.
        self.arm_session(&ctx.session.id);
        Ok(SessionLaunchExtras::default())
    }

    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        // Re-arm synchronously (spawns the timer task); overdue emulated
        // loops coalesce to one immediate fire. Cap enforcement for native
        // mirrors is async (ext round-trip) and detaches.
        self.arm_session(&ctx.session_id);
        let loop_service = self.loop_service.clone();
        let acp_manager = self.acp_manager.clone();
        tokio::spawn(async move {
            if let Err(error) =
                enforce_native_loop_caps_detached(loop_service, acp_manager, &ctx.session_id).await
            {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "native loop cap enforcement failed"
                );
            }
        });
    }

    fn on_session_closing(
        &self,
        ctx: SessionClosingContext,
    ) -> anyhow::Result<SessionClosingActions> {
        self.disarm_session(&ctx.session_id);
        Ok(SessionClosingActions::default())
    }
}

async fn enforce_native_loop_caps_detached(
    loop_service: Arc<LoopService>,
    acp_manager: LiveSessionManager,
    session_id: &str,
) -> anyhow::Result<()> {
    enforce_native_loop_caps(&loop_service, &acp_manager, session_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_contract::v1::LoopScheduleKind;

    fn record(max_fires: Option<i64>, fire_count: i64, max_wall_secs: Option<i64>) -> LoopRecord {
        LoopRecord {
            id: "loop-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            session_id: "session-1".to_string(),
            prompt: "check".to_string(),
            schedule_kind: LoopScheduleKind::Cron,
            schedule_expr: "*/5 * * * *".to_string(),
            recurring: true,
            status: LoopStatus::Active,
            native: true,
            native_loop_id: Some("cron-1".to_string()),
            last_fired_at: None,
            next_fire_at: None,
            fire_count,
            max_fires,
            max_wall_secs,
            source_kind: "user".to_string(),
            cleared_reason: None,
            native_state_json: String::new(),
            revision: 1,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn cap_reason_prefers_fire_cap_then_wall() {
        let now = chrono::Utc::now();
        assert_eq!(
            cap_exceeded_reason(&record(Some(3), 3, None), now),
            Some(LOOP_CLEAR_REASON_MAX_FIRES)
        );
        assert_eq!(cap_exceeded_reason(&record(Some(3), 2, None), now), None);

        let mut walled = record(None, 0, Some(60));
        walled.created_at = (now - chrono::Duration::seconds(120)).to_rfc3339();
        assert_eq!(
            cap_exceeded_reason(&walled, now),
            Some(LOOP_CLEAR_REASON_MAX_WALL)
        );
        assert_eq!(cap_exceeded_reason(&record(None, 100, None), now), None);
    }
}
