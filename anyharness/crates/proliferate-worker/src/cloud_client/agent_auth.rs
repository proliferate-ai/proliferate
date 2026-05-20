use serde::Serialize;

use crate::{
    error::WorkerError,
    materialization::agent_auth::{AgentAuthMaterializationPlan, AgentAuthStatusResponse},
};

use super::{auth, parse_json_response, CloudClient};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthStatusRequest {
    pub status: String,
    pub command_id: String,
    pub revision: i64,
    pub lease_id: String,
    pub applied_revision: Option<i64>,
    pub current_revision: Option<i64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl CloudClient {
    pub async fn fetch_agent_auth_materialization(
        &self,
        worker_token: &str,
        sandbox_profile_id: &str,
        command_id: &str,
        revision: i64,
        lease_id: &str,
    ) -> Result<AgentAuthMaterializationPlan, WorkerError> {
        let revision = revision.to_string();
        let response = self
            .http
            .get(format!(
                "{}/v1/cloud/worker/agent-auth-configs/{}/materialization",
                self.base_url, sandbox_profile_id
            ))
            .query(&[
                ("command_id", command_id),
                ("revision", revision.as_str()),
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

    pub async fn report_agent_auth_status(
        &self,
        worker_token: &str,
        sandbox_profile_id: &str,
        request: &AgentAuthStatusRequest,
    ) -> Result<AgentAuthStatusResponse, WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/agent-auth-configs/{}/status",
                self.base_url, sandbox_profile_id
            ))
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
