use std::sync::Arc;

use super::super::hooks::ReviewHookEvent;
use super::ReviewRuntime;

const REVIEW_RECONCILE_INTERVAL_SECS: u64 = 15;

impl ReviewRuntime {
    pub fn spawn_background_tasks(
        self: Arc<Self>,
        mut hook_events: tokio::sync::mpsc::Receiver<ReviewHookEvent>,
    ) {
        let events_runtime = self.clone();
        tokio::spawn(async move {
            while let Some(event) = hook_events.recv().await {
                events_runtime.handle_hook_event(event).await;
            }
        });

        let reconcile_runtime = self;
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(
                REVIEW_RECONCILE_INTERVAL_SECS,
            ));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                reconcile_runtime.reconcile_active_reviews().await;
            }
        });
    }
}
