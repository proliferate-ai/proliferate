use crate::anyharness_client::AnyHarnessClient;

pub async fn probe(client: &AnyHarnessClient) -> bool {
    let url = format!("{}/health", client.base_url());
    client
        .authenticate(client.http().get(url))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}
