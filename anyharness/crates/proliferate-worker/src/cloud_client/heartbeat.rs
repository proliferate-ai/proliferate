use super::HeartbeatRequest;

pub fn online(
    worker_version: Option<String>,
    anyharness_version: Option<String>,
    supervisor_version: Option<String>,
) -> HeartbeatRequest {
    HeartbeatRequest {
        status: "online".to_string(),
        status_detail: None,
        worker_version,
        anyharness_version,
        supervisor_version,
    }
}
