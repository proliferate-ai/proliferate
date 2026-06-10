use super::HeartbeatRequest;

pub fn report(
    status: impl Into<String>,
    status_detail: Option<String>,
    worker_version: Option<String>,
    anyharness_version: Option<String>,
    supervisor_version: Option<String>,
    catalog_version: Option<String>,
) -> HeartbeatRequest {
    HeartbeatRequest {
        status: status.into(),
        status_detail,
        worker_version,
        anyharness_version,
        supervisor_version,
        catalog_version,
    }
}
