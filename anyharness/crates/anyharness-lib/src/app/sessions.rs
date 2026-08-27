//! Wiring family for the live-session manager: builds the durable
//! capabilities (event/queue/background/state stores + attachment source) and
//! the product reactors (observers, permission advisor), then constructs the
//! manager. Composition only — no behavior.

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::activity::service::ActivityService;
use crate::domains::activity::session_observer::ActivitySessionObserver;
use crate::domains::agent_auth::launch_probe::{LaunchProbeService, PokeReason};
use crate::domains::goals::service::GoalService;
use crate::domains::goals::session_observer::GoalSessionObserver;
use crate::domains::loops::service::LoopService;
use crate::domains::loops::session_observer::LoopSessionObserver;
use crate::domains::plans::permission_advisor::PlanPermissionAdvisor;
use crate::domains::plans::service::PlanService;
use crate::domains::plans::session_observer::PlanSessionObserver;
use crate::domains::reviews::service::ReviewService;
use crate::domains::reviews::session_observer::ReviewSessionObserver;
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::live_ports::SessionAttachmentSource;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::subagents::delivery::{
    CompletionDeliveryStore, CompletionDeliveryWorker,
};
use crate::domains::sessions::subagents::hooks::SubagentSessionHooks;
use crate::live::sessions::model::{
    ActorCapabilities, LaunchObservationInvalidator, PermissionAdvisor, SessionEventObserver,
};
use crate::live::sessions::product_context::AgentProductContextResolver;
use crate::live::sessions::{IdleReapPolicy, LiveSessionManager};
use crate::persistence::Db;

pub(super) struct LiveSessionsWiringDeps {
    pub db: Db,
    pub runtime_home: PathBuf,
    pub plan_service: Arc<PlanService>,
    pub review_service: Arc<ReviewService>,
    pub goal_service: Arc<GoalService>,
    pub loop_service: Arc<LoopService>,
    pub activity_service: Arc<ActivityService>,
    pub product_context: Arc<dyn AgentProductContextResolver>,
    pub automatic_poke_engine: Option<Arc<LaunchProbeService>>,
    pub agent_status_service: Arc<crate::domains::agent_auth::status::AgentStatusService>,
}

struct LaunchObservationProbeQueue {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
}

impl LaunchObservationProbeQueue {
    fn channel() -> (Self, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (Self { tx }, rx)
    }
}

impl LaunchObservationInvalidator for LaunchObservationProbeQueue {
    fn queue_refresh(&self, harness_kind: &str) -> bool {
        self.tx.send(harness_kind.to_string()).is_ok()
    }
}

fn spawn_launch_observation_probe_queue(
    engine: Arc<LaunchProbeService>,
) -> Arc<dyn LaunchObservationInvalidator> {
    let (queue, mut rx) = LaunchObservationProbeQueue::channel();
    // `wire_live_sessions` runs on the application runtime. This receiver and
    // every probe it starts are therefore owned by that long-lived runtime,
    // not by the per-session runtime that reports a startup contradiction and
    // is torn down immediately afterward.
    tokio::spawn(async move {
        while let Some(harness_kind) = rx.recv().await {
            engine
                .clone()
                .poke_harness(&harness_kind, PokeReason::LiveContradiction);
        }
    });
    Arc::new(queue)
}

/// Registration order is the observer dispatch order: plans must run before
/// reviews (reviews consumes the proposed-plan envelopes the plans observer
/// emits, via in-pass feed-forward). Goals consume and feed nothing in-pass,
/// so they run after plans/reviews; loops and activity are registered after
/// goals per the session-activity-architecture build order (both also
/// consume and feed nothing in-pass, so their relative order is
/// unconstrained beyond "after goals").
pub(super) fn wire_live_sessions(deps: &LiveSessionsWiringDeps) -> LiveSessionManager {
    let observers: Vec<Arc<dyn SessionEventObserver>> = vec![
        Arc::new(PlanSessionObserver::new(deps.plan_service.clone())),
        Arc::new(ReviewSessionObserver::new(
            deps.review_service.clone(),
            deps.plan_service.clone(),
        )),
        Arc::new(GoalSessionObserver::new(deps.goal_service.clone())),
        Arc::new(LoopSessionObserver::new(deps.loop_service.clone())),
        Arc::new(ActivitySessionObserver::new(deps.activity_service.clone())),
    ];
    let permission_advisor: Option<Arc<dyn PermissionAdvisor>> = Some(Arc::new(
        PlanPermissionAdvisor::new(deps.plan_service.clone()),
    ));

    let store = SessionStore::new(deps.db.clone());
    let attachment_storage = PromptAttachmentStorage::new(deps.runtime_home.clone());
    let caps = ActorCapabilities {
        events: Arc::new(store.clone()),
        queue: Arc::new(store.clone()),
        background: Arc::new(store.clone()),
        state: Arc::new(store.clone()),
        idle_reap: Arc::new(store.clone()),
        fork_dispatch: Arc::new(store.clone()),
        attachments: Arc::new(SessionAttachmentSource::new(store, attachment_storage)),
        product_context: deps.product_context.clone(),
        observers,
        permission_advisor,
        launch_observation_invalidator: deps
            .automatic_poke_engine
            .clone()
            .map(spawn_launch_observation_probe_queue),
        seat_cooling: Some(Arc::new(
            crate::domains::agents::seat_cooling::SeatCoolingStore::new(deps.db.clone()),
        )),
        agent_status: Some(deps.agent_status_service.clone()),
    };
    let manager = LiveSessionManager::new(caps);
    // Runs on the application runtime, like the launch-observation probe
    // queue above: the sweep task must outlive any single session.
    manager.spawn_idle_reaper(IdleReapPolicy::from_env());
    manager
}

pub(super) struct CompletionDeliveryWiring {
    pub session_hooks: Arc<SubagentSessionHooks>,
    store: CompletionDeliveryStore,
    nudge_rx: tokio::sync::mpsc::UnboundedReceiver<()>,
}

impl CompletionDeliveryWiring {
    pub fn spawn(self, session_runtime: &Arc<SessionRuntime>) {
        CompletionDeliveryWorker::spawn(self.store, Arc::downgrade(session_runtime), self.nudge_rx);
    }
}

pub(super) fn wire_completion_delivery_before_sessions(db: &Db) -> CompletionDeliveryWiring {
    let (nudge_tx, nudge_rx) = tokio::sync::mpsc::unbounded_channel();
    let store = CompletionDeliveryStore::new(db.clone());
    CompletionDeliveryWiring {
        session_hooks: Arc::new(SubagentSessionHooks::new(nudge_tx)),
        store,
        nudge_rx,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contradiction_signal_survives_originating_runtime_shutdown() {
        let (queue, mut rx) = LaunchObservationProbeQueue::channel();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("originating actor runtime");

        runtime.block_on(async {
            assert!(queue.queue_refresh("codex"));
        });
        drop(runtime);

        assert_eq!(
            rx.try_recv().expect("long-lived owner receives signal"),
            "codex"
        );
    }

    #[test]
    fn closed_owner_queue_is_not_reported_as_queued() {
        let (queue, rx) = LaunchObservationProbeQueue::channel();
        drop(rx);

        assert!(!queue.queue_refresh("codex"));
    }
}
