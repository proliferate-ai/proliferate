use super::*;

#[tokio::test]
async fn silent_broker_fails_the_one_second_cli_open_deadline() {
    assert_eq!(CLI_BROKER_OPEN_TIMEOUT, Duration::from_secs(1));
    use std::os::unix::fs::PermissionsExt;

    use crate::diagnostics_collector::broker::discovery::{build_scope, BrokerDiscoveryGuard};

    let root = std::env::temp_dir().join(format!("silent-broker-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).expect("app directory");
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
        .expect("app directory mode");
    let scope = build_scope(
        root.clone(),
        "com.proliferate.app.local.silent-broker".to_string(),
        "development",
        Some("silent_broker".to_string()),
    )
    .expect("broker scope");
    let mut discovery =
        BrokerDiscoveryGuard::acquire(scope.clone(), uuid::Uuid::new_v4().to_string())
            .await
            .expect("discovery lock");
    let listener = tokio::net::UnixListener::bind(&scope.socket_path).expect("silent listener");
    std::fs::set_permissions(&scope.socket_path, std::fs::Permissions::from_mode(0o600))
        .expect("socket mode");
    discovery.publish().expect("publish silent locator");
    let silent = tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.expect("silent accept");
        tokio::time::sleep(Duration::from_secs(3)).await;
    });

    let started = std::time::Instant::now();
    let error = DiagnosticsBrokerClient::for_scope(scope)
        .health()
        .await
        .expect_err("silent broker must hit the open deadline");
    let elapsed = started.elapsed();
    assert_eq!(
        error.classification(),
        DiagnosticsBrokerErrorV1::DeadlineExceeded
    );
    assert!(elapsed >= Duration::from_millis(900));
    assert!(elapsed < Duration::from_secs(2));

    silent.abort();
    let _ = silent.await;
    discovery.cleanup().expect("discovery cleanup");
    std::fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn public_client_has_no_endpoint_or_capability_constructor() {
    let rendered = format!("{:?}", DiagnosticsBrokerClient::new(None));
    assert!(!rendered.contains("endpoint"));
    assert!(!rendered.contains("token"));
    assert!(!rendered.contains("capability"));
}
