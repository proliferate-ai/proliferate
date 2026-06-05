use super::HeartbeatRequest;
use crate::identity::credentials::WorkerIdentity;

pub fn report(
    identity: &WorkerIdentity,
    status: impl Into<String>,
    status_detail: Option<String>,
    worker_version: Option<String>,
    anyharness_version: Option<String>,
    supervisor_version: Option<String>,
) -> HeartbeatRequest {
    HeartbeatRequest {
        sandbox_profile_id: identity.sandbox_profile_id.clone(),
        status: status.into(),
        status_detail,
        worker_version,
        anyharness_version,
        supervisor_version,
    }
}
