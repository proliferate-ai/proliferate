use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{error::WorkerError, materialization::TargetConfigMaterializationPlan};

use super::{auth, parse_empty_response, parse_json_response, CloudClient};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetConfigStatusRequest {
    pub status: String,
    pub command_id: String,
    pub config_version: i64,
    pub lease_id: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigStatusRequest {
    pub status: String,
    pub missing_artifacts: Vec<String>,
    pub missing_credentials: Vec<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigArtifactResponse {
    pub hash: String,
    pub content_type: String,
    pub byte_size: i64,
    pub source_ref: Option<String>,
    pub resource_id: Option<String>,
    pub display_name: Option<String>,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigCredentialMaterializationRequest {
    pub credential_refs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigCredentialValue {
    pub credential_ref: String,
    pub value: String,
}

impl fmt::Debug for RuntimeConfigCredentialValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RuntimeConfigCredentialValue")
            .field("credential_ref", &self.credential_ref)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigCredentialMaterializationResponse {
    pub credentials: Vec<RuntimeConfigCredentialValue>,
    pub missing_credential_refs: Vec<String>,
}

impl fmt::Debug for RuntimeConfigCredentialMaterializationResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RuntimeConfigCredentialMaterializationResponse")
            .field("credential_count", &self.credentials.len())
            .field("missing_credential_refs", &self.missing_credential_refs)
            .finish()
    }
}

impl CloudClient {
    pub async fn fetch_target_config_materialization(
        &self,
        worker_token: &str,
        target_config_id: &str,
        command_id: &str,
        config_version: i64,
        lease_id: &str,
    ) -> Result<TargetConfigMaterializationPlan, WorkerError> {
        let config_version = config_version.to_string();
        let response = self
            .http
            .get(format!(
                "{}/v1/cloud/worker/target-configs/{}/materialization",
                self.base_url, target_config_id
            ))
            .query(&[
                ("command_id", command_id),
                ("config_version", config_version.as_str()),
                ("lease_id", lease_id),
            ])
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .send()
            .await?;
        parse_json_response(response).await
    }

    pub async fn report_target_config_status(
        &self,
        worker_token: &str,
        target_config_id: &str,
        request: &TargetConfigStatusRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/target-configs/{}/status",
                self.base_url, target_config_id
            ))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_empty_response(response).await
    }

    pub async fn report_runtime_config_status(
        &self,
        worker_token: &str,
        revision_id: &str,
        request: &RuntimeConfigStatusRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/runtime-configs/{}/status",
                self.base_url, revision_id
            ))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_empty_response(response).await
    }

    pub async fn fetch_runtime_config_artifact(
        &self,
        worker_token: &str,
        revision_id: &str,
        artifact_hash: &str,
    ) -> Result<RuntimeConfigArtifactResponse, WorkerError> {
        let response = self
            .http
            .get(format!(
                "{}/v1/cloud/worker/runtime-configs/{}/artifacts/{}",
                self.base_url, revision_id, artifact_hash
            ))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .send()
            .await?;
        parse_json_response(response).await
    }

    pub async fn fetch_runtime_config_credentials(
        &self,
        worker_token: &str,
        revision_id: &str,
        credential_refs: Vec<String>,
    ) -> Result<RuntimeConfigCredentialMaterializationResponse, WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/runtime-configs/{}/credentials/materialize",
                self.base_url, revision_id
            ))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(&RuntimeConfigCredentialMaterializationRequest { credential_refs })
            .send()
            .await?;
        parse_json_response(response).await
    }
}
