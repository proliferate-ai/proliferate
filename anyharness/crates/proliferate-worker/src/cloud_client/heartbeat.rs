use super::HeartbeatRequest;

pub fn report(status: impl Into<String>) -> HeartbeatRequest {
    HeartbeatRequest {
        status: Some(status.into()),
    }
}
