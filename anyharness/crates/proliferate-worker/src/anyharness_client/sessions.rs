use reqwest::StatusCode;
use serde_json::Value;

use crate::error::WorkerError;

use super::AnyHarnessClient;

#[derive(Debug)]
pub struct AnyHarnessCommandResponse {
    pub status: StatusCode,
    pub body: Value,
}

impl AnyHarnessCommandResponse {
    pub fn is_success(&self) -> bool {
        self.status.is_success()
    }
}

impl AnyHarnessClient {
    pub async fn send_prompt(
        &self,
        session_id: &str,
        body: &Value,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        self.post_session_json(session_id, "prompt", body).await
    }

    pub async fn resolve_interaction(
        &self,
        session_id: &str,
        request_id: &str,
        body: &Value,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        self.post_session_json(
            session_id,
            &format!("interactions/{}/resolve", request_id),
            body,
        )
        .await
    }

    pub async fn update_session_config(
        &self,
        session_id: &str,
        body: &Value,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        self.post_session_json(session_id, "config-options", body)
            .await
    }

    pub async fn cancel_turn(
        &self,
        session_id: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .http()
            .post(format!(
                "{}/v1/sessions/{}/cancel",
                self.base_url(),
                session_id
            ))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    async fn post_session_json(
        &self,
        session_id: &str,
        path: &str,
        body: &Value,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .http()
            .post(format!(
                "{}/v1/sessions/{}/{}",
                self.base_url(),
                session_id,
                path
            ))
            .json(body)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }
}

async fn parse_anyharness_response(
    response: reqwest::Response,
) -> Result<AnyHarnessCommandResponse, WorkerError> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let body = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text))
    };
    Ok(AnyHarnessCommandResponse { status, body })
}
