use super::*;

fn owned_app_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&path).expect("app dir");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).expect("app mode");
    path
}

#[test]
fn broker_paths_are_distinct_for_production_and_each_dev_profile() {
    let app = owned_app_dir("broker-scope");
    let production = build_scope(
        app.clone(),
        PRODUCTION_IDENTIFIER.to_string(),
        "production",
        None,
    )
    .expect("production");
    let one = build_scope(
        app.clone(),
        "com.proliferate.app.local.one".to_string(),
        "development",
        Some("one".to_string()),
    )
    .expect("one");
    let two = build_scope(
        app.clone(),
        "com.proliferate.app.local.two".to_string(),
        "development",
        Some("two".to_string()),
    )
    .expect("two");
    assert_ne!(production.socket_path, one.socket_path);
    assert_ne!(one.socket_path, two.socket_path);
    fs::remove_dir_all(app).expect("cleanup");
}

#[test]
fn profile_grammar_is_exact() {
    for value in ["a", "abc-123", "abc_123"] {
        assert!(validate_profile(value).is_ok());
    }
    for value in ["", "A", "-abc", "abc.", &"a".repeat(41)] {
        assert!(validate_profile(value).is_err());
    }
}

#[test]
fn broker_runtime_artifacts_are_owner_only() {
    let app = owned_app_dir("broker-modes");
    let scope = build_scope(
        app.clone(),
        PRODUCTION_IDENTIFIER.to_string(),
        "production",
        None,
    )
    .expect("scope");
    ensure_namespace(&scope).expect("namespace");
    let lock = open_persistent_lock(&scope.lock_path).expect("lock");
    assert_eq!(lock.metadata().expect("metadata").mode() & 0o777, 0o600);
    assert_eq!(
        fs::metadata(&scope.run_dir).expect("run").mode() & 0o777,
        0o700
    );
    fs::remove_dir_all(app).expect("cleanup");
}

#[tokio::test]
async fn stale_cleanup_requires_exclusive_lock_and_negative_liveness() {
    let app = owned_app_dir("broker-exclusive-stale");
    let scope = build_scope(
        app.clone(),
        PRODUCTION_IDENTIFIER.to_string(),
        "production",
        None,
    )
    .expect("scope");
    let boot = uuid::Uuid::new_v4().to_string();
    let mut owner = BrokerDiscoveryGuard::acquire(scope.clone(), boot)
        .await
        .expect("first owner");
    let listener = tokio::net::UnixListener::bind(&scope.socket_path).expect("bind");
    fs::set_permissions(&scope.socket_path, fs::Permissions::from_mode(0o600))
        .expect("socket mode");
    owner.publish().expect("publish");

    assert!(matches!(
        BrokerDiscoveryGuard::acquire(scope.clone(), uuid::Uuid::new_v4().to_string()).await,
        Err(DiscoveryError::Busy)
    ));
    assert!(scope.locator_path.exists());
    assert!(scope.socket_path.exists());

    drop(listener);
    owner.cleanup().expect("owner cleanup");
    fs::remove_dir_all(app).expect("cleanup app");
}

#[tokio::test]
async fn live_or_ambiguous_locator_is_never_removed() {
    let app = owned_app_dir("broker-live-ambiguous");
    let scope = build_scope(
        app.clone(),
        PRODUCTION_IDENTIFIER.to_string(),
        "production",
        None,
    )
    .expect("scope");
    ensure_namespace(&scope).expect("namespace");
    let listener = tokio::net::UnixListener::bind(&scope.socket_path).expect("bind");
    fs::set_permissions(&scope.socket_path, fs::Permissions::from_mode(0o600))
        .expect("socket mode");

    assert!(matches!(
        probe_old_broker(&scope.socket_path, None).await,
        Ok(Liveness::Ambiguous)
    ));
    assert!(scope.socket_path.exists());

    drop(listener);
    fs::remove_file(&scope.socket_path).expect("remove socket");
    fs::remove_dir_all(app).expect("cleanup app");
}

#[tokio::test]
async fn matching_stale_probe_verifies_uid_pid_and_boot_without_removing_socket() {
    let app = owned_app_dir("broker-matching-handshake");
    let scope = build_scope(
        app.clone(),
        PRODUCTION_IDENTIFIER.to_string(),
        "production",
        None,
    )
    .expect("scope");
    ensure_namespace(&scope).expect("namespace");
    let listener = tokio::net::UnixListener::bind(&scope.socket_path).expect("bind");
    fs::set_permissions(&scope.socket_path, fs::Permissions::from_mode(0o600))
        .expect("socket mode");
    let app_boot_id = uuid::Uuid::new_v4().to_string();
    let expected_boot = app_boot_id.clone();
    let responder = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept probe");
        let length = stream.read_u32().await.expect("request length") as usize;
        let mut request_bytes = vec![0_u8; length];
        stream
            .read_exact(&mut request_bytes)
            .await
            .expect("request body");
        let request = super::super::protocol::parse_exact_request(&request_bytes)
            .expect("exact health probe");
        assert_eq!(request.app_boot_id(), expected_boot);
        let response = DiagnosticsBrokerResponseV1::Accepted {
            protocol_version: BROKER_PROTOCOL_VERSION,
            app_boot_id: expected_boot,
            request_id: request.request_id().to_string(),
        };
        let bytes = serde_json::to_vec(&response).expect("response");
        stream.write_u32(bytes.len() as u32).await.expect("length");
        stream.write_all(&bytes).await.expect("body");
    });
    let locator = DiagnosticsBrokerLocatorV1 {
        schema_version: BROKER_PROTOCOL_VERSION,
        locator: DiagnosticsBrokerLocatorAddressV1::UnixStream {
            path: scope.socket_path.to_string_lossy().into_owned(),
        },
        app_boot_id,
        pid: std::process::id(),
        updated_at: Utc::now().to_rfc3339(),
    };

    assert!(matches!(
        probe_old_broker(&scope.socket_path, Some(&locator)).await,
        Ok(Liveness::Matching)
    ));
    responder.await.expect("probe responder");
    assert!(scope.socket_path.exists());

    fs::remove_file(&scope.socket_path).expect("remove socket");
    fs::remove_dir_all(app).expect("cleanup app");
}

#[tokio::test]
async fn old_boot_cannot_remove_new_boot_locator() {
    let app = owned_app_dir("broker-old-boot-cleanup");
    let scope = build_scope(
        app.clone(),
        PRODUCTION_IDENTIFIER.to_string(),
        "production",
        None,
    )
    .expect("scope");
    let old_boot = uuid::Uuid::new_v4().to_string();
    let new_boot = uuid::Uuid::new_v4().to_string();
    let mut old = BrokerDiscoveryGuard::acquire(scope.clone(), old_boot)
        .await
        .expect("old owner");
    let listener = tokio::net::UnixListener::bind(&scope.socket_path).expect("bind");
    fs::set_permissions(&scope.socket_path, fs::Permissions::from_mode(0o600))
        .expect("socket mode");
    old.publish().expect("publish old");
    let replacement = DiagnosticsBrokerLocatorV1 {
        schema_version: BROKER_PROTOCOL_VERSION,
        locator: DiagnosticsBrokerLocatorAddressV1::UnixStream {
            path: scope.socket_path.to_string_lossy().into_owned(),
        },
        app_boot_id: new_boot,
        pid: std::process::id(),
        updated_at: Utc::now().to_rfc3339(),
    };
    fs::write(
        &scope.locator_path,
        serde_json::to_vec(&replacement).expect("locator JSON"),
    )
    .expect("replace locator");

    old.cleanup().expect("old cleanup");
    assert!(scope.locator_path.exists());
    assert!(scope.socket_path.exists());

    drop(listener);
    fs::remove_file(&scope.locator_path).expect("remove locator");
    fs::remove_file(&scope.socket_path).expect("remove socket");
    fs::remove_dir_all(app).expect("cleanup app");
}
