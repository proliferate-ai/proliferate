use crate::cloud_client::updates::UpdateStatusRequest;

pub fn staging() -> UpdateStatusRequest {
    UpdateStatusRequest {
        status: "staging".to_string(),
        component: None,
        version: None,
        detail: Some("Desired runtime versions received; staging update request.".to_string()),
        error_code: None,
        error_message: None,
    }
}

pub fn failed(error_message: String) -> UpdateStatusRequest {
    UpdateStatusRequest {
        status: "failed".to_string(),
        component: None,
        version: None,
        detail: None,
        error_code: Some("worker_update_stage_failed".to_string()),
        error_message: Some(error_message),
    }
}
