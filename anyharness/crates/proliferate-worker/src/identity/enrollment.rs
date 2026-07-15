use crate::{
    cloud_client::{EnrollRequest, EnrollResponse, IntegrationGatewayConfig},
    config::WorkerConfig,
    error::WorkerError,
    identity::{credentials::WorkerIdentity, fingerprint},
    versions,
};

pub fn build_enroll_request(config: &WorkerConfig) -> Result<EnrollRequest, WorkerError> {
    let enrollment_token = config
        .enrollment_token
        .clone()
        .ok_or(WorkerError::MissingEnrollmentToken)?;
    Ok(EnrollRequest {
        enrollment_token,
        machine_fingerprint: Some(fingerprint::machine_fingerprint()),
        hostname: fingerprint::hostname(),
        worker_version: versions::worker_version(),
        // None until a launcher exports the env; see versions::anyharness_version.
        anyharness_version: versions::anyharness_version(),
    })
}

/// Split the enroll response into the persisted identity (worker_id +
/// worker_token) and the integration-gateway config the runtime writes to the
/// dotfile.
pub fn identity_from_response(
    response: EnrollResponse,
) -> (WorkerIdentity, IntegrationGatewayConfig) {
    let identity = WorkerIdentity {
        worker_id: response.worker_id,
        worker_token: response.worker_token,
    };
    (identity, response.integration_gateway)
}
