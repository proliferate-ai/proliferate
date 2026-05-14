use crate::anyharness_client::AnyHarnessClient;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    version: String,
}

pub async fn probe(client: &AnyHarnessClient) -> bool {
    version(client).await.is_some()
}

pub async fn version(client: &AnyHarnessClient) -> Option<String> {
    let url = format!("{}/health", client.base_url());
    client
        .authenticate(client.http().get(url))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<HealthResponse>()
        .await
        .ok()
        .map(|response| response.version)
}
