use crate::{
    cloud_client::{EnrollRequest, InventoryPayload},
    config::WorkerConfig,
    error::WorkerError,
    identity::{credentials::WorkerIdentity, fingerprint},
};

pub fn build_enroll_request(
    config: &WorkerConfig,
    inventory: InventoryPayload,
) -> Result<EnrollRequest, WorkerError> {
    let enrollment_token = config
        .enrollment_token
        .clone()
        .ok_or(WorkerError::MissingEnrollmentToken)?;
    Ok(EnrollRequest {
        enrollment_token,
        machine_fingerprint: fingerprint::machine_fingerprint(),
        hostname: fingerprint::hostname(),
        worker_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        anyharness_version: None,
        supervisor_version: None,
        inventory,
    })
}

pub fn identity_from_response(response: crate::cloud_client::EnrollResponse) -> WorkerIdentity {
    let _cloud_heartbeat_interval_seconds = response.heartbeat_interval_seconds;
    WorkerIdentity {
        target_id: response.target_id,
        worker_id: response.worker_id,
        worker_token: response.worker_token,
    }
}
