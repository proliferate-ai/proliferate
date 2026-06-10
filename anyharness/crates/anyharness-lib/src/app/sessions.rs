//! Wiring family for the live-session manager: builds the product reactors
//! (observers, permission advisor) and constructs the manager. Composition
//! only — no behavior.

use std::sync::Arc;

use crate::domains::plans::permission_advisor::PlanPermissionAdvisor;
use crate::domains::plans::service::PlanService;
use crate::domains::plans::session_observer::PlanSessionObserver;
use crate::domains::reviews::service::ReviewService;
use crate::domains::reviews::session_observer::ReviewSessionObserver;
use crate::live::sessions::model::{PermissionAdvisor, SessionEventObserver};
use crate::live::sessions::LiveSessionManager;

pub(super) struct LiveSessionsWiringDeps {
    pub plan_service: Arc<PlanService>,
    pub review_service: Arc<ReviewService>,
}

/// Registration order is the observer dispatch order: plans must run before
/// reviews (reviews consumes the proposed-plan envelopes the plans observer
/// emits, via in-pass feed-forward).
pub(super) fn wire_live_sessions(deps: &LiveSessionsWiringDeps) -> LiveSessionManager {
    let observers: Vec<Arc<dyn SessionEventObserver>> = vec![
        Arc::new(PlanSessionObserver::new(deps.plan_service.clone())),
        Arc::new(ReviewSessionObserver::new(
            deps.review_service.clone(),
            deps.plan_service.clone(),
        )),
    ];
    let permission_advisor: Option<Arc<dyn PermissionAdvisor>> = Some(Arc::new(
        PlanPermissionAdvisor::new(deps.plan_service.clone()),
    ));
    LiveSessionManager::new(observers, permission_advisor)
}
