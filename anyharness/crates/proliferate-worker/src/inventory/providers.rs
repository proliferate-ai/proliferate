use serde_json::json;

pub async fn probe_provider_readiness() -> serde_json::Value {
    json!({
        "status": "unknown",
        "providers": [],
        "message": "provider readiness is delegated to AnyHarness runtime inventory when available"
    })
}
