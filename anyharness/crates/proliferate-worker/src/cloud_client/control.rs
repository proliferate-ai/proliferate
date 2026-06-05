use serde::{Deserialize, Serialize};

use crate::error::WorkerError;

use super::{
    auth, commands::CloudCommandEnvelope, exposures::WorkerExposureSnapshot, parse_json_response,
    revoked_jti::WorkerRevokedJtisResponse, CloudClient,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerControlWaitRequest {
    pub supported_kinds: Vec<String>,
    pub lease_timeout_seconds: Option<u64>,
    pub control_cursor: Option<String>,
    pub revoked_jti_cursor: Option<String>,
    pub lease_commands: bool,
    pub wait_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerControlWaitResponse {
    pub command: Option<CloudCommandEnvelope>,
    pub exposures: Option<Vec<WorkerExposureSnapshot>>,
    pub revoked_jtis: Option<WorkerRevokedJtisResponse>,
    pub control_cursor: String,
    pub reason: String,
    pub server_time: String,
}

impl CloudClient {
    pub async fn wait_worker_control(
        &self,
        worker_token: &str,
        request: &WorkerControlWaitRequest,
    ) -> Result<WorkerControlWaitResponse, WorkerError> {
        let response = self
            .http
            .post(format!("{}/v1/cloud/worker/control/wait", self.base_url))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_json_response(response).await
    }
}

#[cfg(test)]
mod tests {
    use super::WorkerControlWaitResponse;

    #[test]
    fn wait_response_deserializes_commandless_exposure_update() {
        let payload = br#"{
            "command": null,
            "exposures": [],
            "revokedJtis": null,
            "controlCursor": "v2:00000000-0000-0000-0000-000000000001:2:1:0",
            "reason": "exposures",
            "serverTime": "2026-05-14T00:00:00Z"
        }"#;
        let response: WorkerControlWaitResponse =
            serde_json::from_slice(payload).expect("response");
        assert!(response.command.is_none());
        assert_eq!(response.exposures.expect("exposures").len(), 0);
        assert_eq!(
            response.control_cursor,
            "v2:00000000-0000-0000-0000-000000000001:2:1:0"
        );
    }

    #[test]
    fn wait_response_deserializes_revoked_jtis() {
        let payload = br#"{
            "command": null,
            "exposures": null,
            "revokedJtis": {
                "revokedJtis": [{
                    "jtiHash": "hash-1",
                    "hashKeyId": "sha256-v1",
                    "expiresAt": "2026-05-14T01:00:00Z",
                    "revokedAt": "2026-05-14T00:00:00Z"
                }],
                "serverTime": "2026-05-14T00:00:00Z",
                "nextCursor": "2026-05-14T00:00:00Z|00000000-0000-0000-0000-000000000001",
                "hasMore": false
            },
            "controlCursor": "v2:00000000-0000-0000-0000-000000000001:3:1:1",
            "reason": "revoked_jtis",
            "serverTime": "2026-05-14T00:00:00Z"
        }"#;
        let response: WorkerControlWaitResponse =
            serde_json::from_slice(payload).expect("response");
        let revoked = response.revoked_jtis.expect("revoked jtis");
        assert_eq!(revoked.revoked_jtis.len(), 1);
        assert_eq!(revoked.revoked_jtis[0].jti_hash, "hash-1");
        assert!(!revoked.has_more);
    }
}
