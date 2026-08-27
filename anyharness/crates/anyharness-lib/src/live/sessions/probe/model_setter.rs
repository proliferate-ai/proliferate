use agent_client_protocol as acp;

const ACP_SET_SESSION_MODEL_METHOD: &str = "session/set_model";

/// Setter confirmation for harnesses that enumerate models only through the
/// initialize response's vendor `_meta.modelState` (parsed by
/// `driver::types::model_state_from_init_meta`). Enumeration is not
/// executable authority until the setter reads a value back.
pub(super) async fn set_init_meta_model_and_confirm(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    model_id: &str,
) -> anyhow::Result<bool> {
    let params: std::sync::Arc<serde_json::value::RawValue> =
        serde_json::value::to_raw_value(&serde_json::json!({
            "sessionId": native_session_id,
            "modelId": model_id,
        }))?
        .into();
    let response = conn
        .send_request(acp::AgentRequest::ExtMethodRequest(
            acp::schema::ExtRequest::new(ACP_SET_SESSION_MODEL_METHOD, params),
        ))
        .block_task()
        .await?;
    Ok(confirmed_model_from_ext_response(&response).as_deref() == Some(model_id))
}

fn confirmed_model_from_ext_response(response: &serde_json::Value) -> Option<String> {
    [
        "/_meta/model/Ok",
        "/_meta/modelState/currentModelId",
        "/currentModelId",
        "/modelId",
    ]
    .into_iter()
    .find_map(|pointer| response.pointer(pointer)?.as_str().map(str::to_string))
}

#[cfg(test)]
mod tests;
