use super::HeartbeatRequest;
use crate::versions;

pub fn report(status: impl Into<String>) -> HeartbeatRequest {
    HeartbeatRequest {
        status: Some(status.into()),
        worker_version: versions::worker_version(),
        anyharness_version: versions::anyharness_version(),
    }
}
