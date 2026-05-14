use crate::anyharness_client::AnyHarnessClient;

pub async fn probe(client: &AnyHarnessClient) -> bool {
    let url = format!("{}/v1/health", client.base_url());
    client
        .http()
        .get(url)
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}
