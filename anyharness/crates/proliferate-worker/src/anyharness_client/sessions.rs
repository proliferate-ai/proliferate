use anyharness_contract::v1::ApplyRuntimeConfigRequest;
use reqwest::StatusCode;
use serde_json::Value;
use tokio::time::{sleep, Duration, Instant};

use crate::commands::mapping::PlanDecision;
use crate::error::WorkerError;

use super::AnyHarnessClient;

const LIVE_CONFIG_APPLY_TIMEOUT: Duration = Duration::from_secs(60);
const LIVE_CONFIG_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug)]
pub struct AnyHarnessCommandResponse {
    pub status: StatusCode,
    pub body: Value,
}

enum NormalizedControlLookup {
    Found(Value),
    Missing,
    Failed(AnyHarnessCommandResponse),
}

impl AnyHarnessCommandResponse {
    pub fn is_success(&self) -> bool {
        self.status.is_success()
    }
}

impl AnyHarnessClient {
    pub async fn apply_runtime_config(
        &self,
        body: &ApplyRuntimeConfigRequest,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(
                self.http()
                    .put(format!("{}/v1/runtime-config", self.base_url())),
            )
            .json(body)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn start_session(
        &self,
        body: &Value,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().post(format!("{}/v1/sessions", self.base_url())))
            .json(body)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

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

    pub async fn decide_plan(
        &self,
        workspace_id: &str,
        plan_id: &str,
        decision: &PlanDecision,
        expected_decision_version: i64,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let action = match decision {
            PlanDecision::Approve => "approve",
            PlanDecision::Reject => "reject",
        };
        let response = self
            .authenticate(self.http().post(format!(
                "{}/v1/workspaces/{}/plans/{}/{}",
                self.base_url(),
                workspace_id,
                plan_id,
                action
            )))
            .json(&serde_json::json!({
                "expectedDecisionVersion": expected_decision_version,
            }))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn update_session_config(
        &self,
        session_id: &str,
        body: &Value,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        self.post_session_json(session_id, "config-options", body)
            .await
    }

    pub async fn update_normalized_session_config(
        &self,
        session_id: &str,
        control_id: &str,
        value: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let deadline = Instant::now() + LIVE_CONFIG_APPLY_TIMEOUT;
        let control = match self
            .wait_for_normalized_control(session_id, control_id, deadline)
            .await?
        {
            NormalizedControlLookup::Found(control) => control,
            NormalizedControlLookup::Missing => {
                return Ok(normalized_control_unavailable_response(control_id));
            }
            NormalizedControlLookup::Failed(response) => return Ok(response),
        };
        if control.get("currentValue").and_then(Value::as_str) == Some(value) {
            return Ok(normalized_config_applied_response());
        }
        let value_allowed = control
            .get("values")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .any(|candidate| candidate.get("value").and_then(Value::as_str) == Some(value))
            })
            .unwrap_or(false);
        if !value_allowed {
            return Ok(AnyHarnessCommandResponse {
                status: StatusCode::BAD_REQUEST,
                body: serde_json::json!({
                    "error": "normalized config value is not supported",
                    "controlId": control_id,
                    "value": value,
                }),
            });
        }
        let Some(config_id) = control.get("rawConfigId").and_then(Value::as_str) else {
            return Ok(AnyHarnessCommandResponse {
                status: StatusCode::BAD_REQUEST,
                body: serde_json::json!({
                    "error": "normalized config control has no raw config id",
                    "controlId": control_id,
                }),
            });
        };
        let apply_response = self
            .update_session_config(
                session_id,
                &serde_json::json!({ "configId": config_id, "value": value }),
            )
            .await?;
        if !apply_response.is_success() {
            return Ok(apply_response);
        }
        loop {
            if Instant::now() >= deadline {
                return Ok(apply_response);
            }
            sleep(LIVE_CONFIG_POLL_INTERVAL).await;
            let control = match self
                .wait_for_normalized_control(session_id, control_id, deadline)
                .await?
            {
                NormalizedControlLookup::Found(control) => control,
                NormalizedControlLookup::Missing | NormalizedControlLookup::Failed(_) => {
                    return Ok(apply_response);
                }
            };
            if control.get("currentValue").and_then(Value::as_str) == Some(value) {
                return Ok(normalized_config_applied_response());
            }
        }
    }

    pub async fn cancel_turn(
        &self,
        session_id: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().post(format!(
                "{}/v1/sessions/{}/cancel",
                self.base_url(),
                session_id
            )))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    pub async fn close_session(
        &self,
        session_id: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().post(format!(
                "{}/v1/sessions/{}/close",
                self.base_url(),
                session_id
            )))
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
            .authenticate(self.http().post(format!(
                "{}/v1/sessions/{}/{}",
                self.base_url(),
                session_id,
                path
            )))
            .json(body)
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    async fn get_live_config(
        &self,
        session_id: &str,
    ) -> Result<AnyHarnessCommandResponse, WorkerError> {
        let response = self
            .authenticate(self.http().get(format!(
                "{}/v1/sessions/{}/live-config",
                self.base_url(),
                session_id
            )))
            .send()
            .await?;
        parse_anyharness_response(response).await
    }

    async fn wait_for_normalized_control(
        &self,
        session_id: &str,
        control_id: &str,
        deadline: Instant,
    ) -> Result<NormalizedControlLookup, WorkerError> {
        loop {
            let live_config = self.get_live_config(session_id).await?;
            if !live_config.is_success() {
                return Ok(NormalizedControlLookup::Failed(live_config));
            }
            if let Some(control) = find_normalized_control(&live_config.body, control_id) {
                return Ok(NormalizedControlLookup::Found(control));
            }
            if Instant::now() >= deadline {
                return Ok(NormalizedControlLookup::Missing);
            }
            sleep(LIVE_CONFIG_POLL_INTERVAL).await;
        }
    }
}

fn find_normalized_control(live_config_body: &Value, control_id: &str) -> Option<Value> {
    let controls = live_config_body
        .get("liveConfig")
        .and_then(|live| live.get("normalizedControls"))?;
    if let Some(control) = controls.get(control_id).filter(|value| value.is_object()) {
        return Some(control.clone());
    }
    let controls_object = controls.as_object()?;
    for (slot, control) in controls_object {
        if slot == "extras" || !control.is_object() {
            continue;
        }
        if normalized_control_matches(control, control_id) {
            return Some(control.clone());
        }
    }
    controls
        .get("extras")
        .and_then(Value::as_array)
        .and_then(|extras| {
            extras
                .iter()
                .find(|control| normalized_control_matches(control, control_id))
                .cloned()
        })
}

fn normalized_control_matches(control: &Value, control_id: &str) -> bool {
    control.get("key").and_then(Value::as_str) == Some(control_id)
}

fn normalized_config_applied_response() -> AnyHarnessCommandResponse {
    AnyHarnessCommandResponse {
        status: StatusCode::OK,
        body: serde_json::json!({ "applyState": "applied" }),
    }
}

fn normalized_control_unavailable_response(control_id: &str) -> AnyHarnessCommandResponse {
    AnyHarnessCommandResponse {
        status: StatusCode::BAD_REQUEST,
        body: serde_json::json!({
            "error": "normalized config control is unavailable",
            "controlId": control_id,
        }),
    }
}

pub(crate) async fn parse_anyharness_response(
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::find_normalized_control;

    #[test]
    fn finds_normalized_control_by_semantic_key_in_camel_slot() {
        let body = json!({
            "liveConfig": {
                "normalizedControls": {
                    "fastMode": {
                        "key": "fast_mode",
                        "label": "Fast mode",
                        "rawConfigId": "cfg-fast",
                        "currentValue": "on",
                        "values": [{ "value": "on" }, { "value": "off" }]
                    }
                }
            }
        });

        let control = find_normalized_control(&body, "fast_mode").expect("control");
        assert_eq!(control["rawConfigId"], "cfg-fast");
    }

    #[test]
    fn finds_normalized_control_by_semantic_key_in_extras() {
        let body = json!({
            "liveConfig": {
                "normalizedControls": {
                    "model": {
                        "key": "model",
                        "rawConfigId": "cfg-model",
                        "currentValue": "opus",
                        "values": [{ "value": "opus" }]
                    },
                    "extras": [
                        {
                            "key": "reasoning_effort",
                            "label": "Reasoning",
                            "rawConfigId": "cfg-reasoning",
                            "currentValue": "high",
                            "values": [{ "value": "medium" }, { "value": "high" }]
                        }
                    ]
                }
            }
        });

        let control = find_normalized_control(&body, "reasoning_effort").expect("control");
        assert_eq!(control["rawConfigId"], "cfg-reasoning");
    }

    #[test]
    fn preserves_direct_slot_lookup_for_legacy_callers() {
        let body = json!({
            "liveConfig": {
                "normalizedControls": {
                    "mode": {
                        "key": "permission_mode",
                        "rawConfigId": "cfg-mode",
                        "currentValue": "plan",
                        "values": [{ "value": "plan" }]
                    }
                }
            }
        });

        let control = find_normalized_control(&body, "mode").expect("control");
        assert_eq!(control["rawConfigId"], "cfg-mode");
    }

    #[test]
    fn does_not_return_extras_array_as_control() {
        let body = json!({
            "liveConfig": {
                "normalizedControls": {
                    "extras": []
                }
            }
        });

        assert!(find_normalized_control(&body, "extras").is_none());
    }
}
