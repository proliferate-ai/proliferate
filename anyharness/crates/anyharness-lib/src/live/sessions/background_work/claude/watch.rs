use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::output::{inspect_output_file, parse_timestamp, resolve_output_path};
use super::{BackgroundWorkOptions, BackgroundWorkUpdate, BACKGROUND_WORK_FALLBACK_RESULT};
use crate::sessions::model::{SessionBackgroundWorkRecord, SessionBackgroundWorkState};
use crate::sessions::store::SessionStore;

pub(super) fn spawn_async_agent_tracker(
    record: SessionBackgroundWorkRecord,
    store: SessionStore,
    updates_tx: mpsc::UnboundedSender<BackgroundWorkUpdate>,
    options: BackgroundWorkOptions,
) -> JoinHandle<()> {
    tokio::task::spawn_local(async move {
        watch_async_agent(record, store, updates_tx, options).await;
    })
}

pub(super) async fn watch_async_agent(
    record: SessionBackgroundWorkRecord,
    store: SessionStore,
    updates_tx: mpsc::UnboundedSender<BackgroundWorkUpdate>,
    options: BackgroundWorkOptions,
) {
    let output_path = resolve_output_path(&record.output_file).await;
    let mut cursor = 0_u64;
    let mut remainder = Vec::new();
    let mut last_activity_at = parse_timestamp(&record.last_activity_at);
    let mut interval = tokio::time::interval(options.poll_interval);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        match inspect_output_file(&output_path, &mut cursor, &mut remainder).await {
            Ok(observation) => {
                if let Some(activity_at) = observation.activity_at {
                    if activity_at > last_activity_at {
                        last_activity_at = activity_at;
                        if let Err(error) = store.touch_background_work_activity(
                            &record.session_id,
                            &record.tool_call_id,
                            &activity_at.to_rfc3339(),
                        ) {
                            tracing::warn!(
                                session_id = %record.session_id,
                                tool_call_id = %record.tool_call_id,
                                error = %error,
                                "failed to update background work activity timestamp"
                            );
                        }
                    }
                }

                if let Some(result_text) = observation.result_text {
                    let _ = updates_tx.send(BackgroundWorkUpdate {
                        tool_call_id: record.tool_call_id.clone(),
                        turn_id: record.turn_id.clone(),
                        state: SessionBackgroundWorkState::Completed,
                        agent_id: record.agent_id.clone(),
                        output_file: record.output_file.clone(),
                        result_text,
                    });
                    return;
                }
            }
            Err(error) => {
                tracing::debug!(
                    session_id = %record.session_id,
                    tool_call_id = %record.tool_call_id,
                    output_file = %record.output_file,
                    error = %error,
                    "background work tracker failed to inspect output file"
                );
            }
        }

        if let Some(stale_after) = options.stale_after {
            let stale_after = chrono::Duration::from_std(stale_after).unwrap_or_else(|_| {
                chrono::Duration::from_std(Duration::from_secs(60 * 10)).expect("default duration")
            });
            if chrono::Utc::now().signed_duration_since(last_activity_at) >= stale_after {
                let _ = updates_tx.send(BackgroundWorkUpdate {
                    tool_call_id: record.tool_call_id.clone(),
                    turn_id: record.turn_id.clone(),
                    state: SessionBackgroundWorkState::Expired,
                    agent_id: record.agent_id.clone(),
                    output_file: record.output_file.clone(),
                    result_text: BACKGROUND_WORK_FALLBACK_RESULT.to_string(),
                });
                return;
            }
        }

        interval.tick().await;
    }
}
