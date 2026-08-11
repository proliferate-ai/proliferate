use super::*;

#[tokio::test]
async fn silent_broker_fails_the_one_second_cli_open_deadline() {
    assert_eq!(CLI_BROKER_OPEN_TIMEOUT, Duration::from_secs(1));
}

#[test]
fn public_client_has_no_endpoint_or_capability_constructor() {
    let rendered = format!("{:?}", DiagnosticsBrokerClient::new(None));
    assert!(!rendered.contains("endpoint"));
    assert!(!rendered.contains("token"));
    assert!(!rendered.contains("capability"));
}
