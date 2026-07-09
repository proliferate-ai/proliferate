//! Wiring family for the live-session manager: builds the durable
//! capabilities (event/queue/background/state stores + attachment source) and
//! the product reactors (observers, permission advisor), then constructs the
//! manager. Composition only — no behavior.

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::activity::service::ActivityService;
use crate::domains::activity::session_observer::ActivitySessionObserver;
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
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::model::{ActorCapabilities, PermissionAdvisor, SessionEventObserver};
use crate::live::sessions::LiveSessionManager;
use crate::persistence::Db;

pub(super) struct LiveSessionsWiringDeps {
    pub db: Db,
    pub runtime_home: PathBuf,
    pub plan_service: Arc<PlanService>,
    pub review_service: Arc<ReviewService>,
    pub goal_service: Arc<GoalService>,
    pub loop_service: Arc<LoopService>,
    pub activity_service: Arc<ActivityService>,
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
        attachments: Arc::new(SessionAttachmentSource::new(store, attachment_storage)),
        observers,
        permission_advisor,
    };
    LiveSessionManager::new(caps)
}
