use serde::Serialize;

use crate::{
    error::WorkerError, materialization::git_identity::TargetGitIdentityMaterializationPlan,
};

use super::{auth, parse_empty_response, parse_json_response, CloudClient};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetGitIdentityStatusRequest {
    pub status: String,
    pub command_id: String,
    pub config_version: i64,
    pub lease_id: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl CloudClient {
    pub async fn fetch_target_git_identity_materialization(
        &self,
        worker_token: &str,
        identity_id: &str,
        command_id: &str,
        config_version: i64,
        lease_id: &str,
    ) -> Result<TargetGitIdentityMaterializationPlan, WorkerError> {
        let config_version = config_version.to_string();
        let response = self
            .http
            .get(format!(
                "{}/v1/cloud/worker/target-git-identities/{}/materialization",
                self.base_url, identity_id
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

    pub async fn report_target_git_identity_status(
        &self,
        worker_token: &str,
        identity_id: &str,
        request: &TargetGitIdentityStatusRequest,
    ) -> Result<(), WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/target-git-identities/{}/status",
                self.base_url, identity_id
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
}
