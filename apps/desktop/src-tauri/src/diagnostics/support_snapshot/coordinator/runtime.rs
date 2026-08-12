use chrono::{DateTime, Utc};
use tokio::time::Instant;

pub(super) trait CoordinatorRuntime: Send + Sync {
    fn utc_now(&self) -> DateTime<Utc>;
    fn instant_now(&self) -> Instant;
    fn new_id(&self) -> String;
}

pub(super) struct SystemCoordinatorRuntime;

impl CoordinatorRuntime for SystemCoordinatorRuntime {
    fn utc_now(&self) -> DateTime<Utc> {
        Utc::now()
    }

    fn instant_now(&self) -> Instant {
        Instant::now()
    }

    fn new_id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}
