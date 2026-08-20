use agent_client_protocol as acp;

const ACP_SET_SESSION_MODEL_METHOD: &str = "session/set_model";

/// Some harnesses advertise models only through the initialize response's
/// vendor `_meta.modelState`. Keep parsing and setter confirmation together:
/// enumeration is not executable authority until the setter reads a value back.
pub(super) fn model_entries_from_model_state(
    model_state: &serde_json::Value,
) -> Option<Vec<(String, String, Option<String>)>> {
    let models = model_state.get("availableModels")?.as_array()?;
    let entries: Vec<(String, String, Option<String>)> = models
        .iter()
        .filter_map(|model| {
            let id = model.get("modelId").and_then(|value| value.as_str())?;
            let name = model
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or(id)
                .to_string();
            let description = model
                .get("description")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            Some((id.to_string(), name, description))
        })
        .collect();
    (!entries.is_empty()).then_some(entries)
}

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
