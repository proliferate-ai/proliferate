use crate::cloud_client::updates::UpdateStatusRequest;

pub fn staged(
    update_generation: i64,
    component: Option<String>,
    version: Option<String>,
    detail: String,
) -> UpdateStatusRequest {
    UpdateStatusRequest {
        status: "staged".to_string(),
        update_generation,
        component,
        version,
        detail: Some(detail),
        error_code: None,
        error_message: None,
    }
}

pub fn failed(update_generation: i64, error_message: String) -> UpdateStatusRequest {
    UpdateStatusRequest {
        status: "failed".to_string(),
        update_generation,
        component: None,
        version: None,
        detail: None,
        error_code: Some("worker_update_stage_failed".to_string()),
        error_message: Some(error_message),
    }
}
