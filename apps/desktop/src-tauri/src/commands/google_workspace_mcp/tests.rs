use super::*;

#[test]
fn encodes_credential_email_like_workspace_mcp() {
    assert_eq!(
        encode_credential_email("user@example.com"),
        "user@example.com"
    );
    assert_eq!(
        encode_credential_email("user+tag@example.com"),
        "user%2Btag@example.com"
    );
    assert_eq!(
        decode_credential_email("user%2Btag@example.com").as_deref(),
        Some("user+tag@example.com"),
    );
}

#[test]
fn validates_readonly_scope_strictly() {
    let credential = LocalCredential {
        token: Some("token".to_string()),
        refresh_token: Some("refresh".to_string()),
        token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
        client_id: Some("client-id".to_string()),
        client_secret: Some("client-secret".to_string()),
        scopes: vec![GMAIL_READONLY_SCOPE.to_string()],
        expiry: None,
    };
    assert!(validate_credential(&credential).is_ok());

    let broad = LocalCredential {
        token: Some("token".to_string()),
        refresh_token: Some("refresh".to_string()),
        token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
        client_id: Some("client-id".to_string()),
        client_secret: Some("client-secret".to_string()),
        scopes: vec![
            GMAIL_READONLY_SCOPE.to_string(),
            "https://www.googleapis.com/auth/gmail.modify".to_string(),
        ],
        expiry: None,
    };
    assert!(validate_credential(&broad).is_err());

    let identity_shorthand = LocalCredential {
        token: Some("token".to_string()),
        refresh_token: Some("refresh".to_string()),
        token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
        client_id: Some("client-id".to_string()),
        client_secret: Some("client-secret".to_string()),
        scopes: vec![
            GMAIL_READONLY_SCOPE.to_string(),
            "openid".to_string(),
            "email".to_string(),
            "profile".to_string(),
        ],
        expiry: None,
    };
    assert!(validate_credential(&identity_shorthand).is_ok());
}

#[test]
fn expired_refreshable_credential_has_no_fresh_access_token() {
    let credential = LocalCredential {
        token: Some("token".to_string()),
        refresh_token: Some("refresh".to_string()),
        token_uri: Some(GOOGLE_TOKEN_URI.to_string()),
        client_id: Some("client-id".to_string()),
        client_secret: Some("client-secret".to_string()),
        scopes: vec![GMAIL_READONLY_SCOPE.to_string()],
        expiry: Some(Utc::now() - chrono::Duration::minutes(1)),
    };
    assert!(validate_credential(&credential).is_ok());
    assert!(!access_token_is_fresh(&credential));
}

#[test]
fn runtime_port_is_deterministic_for_launch_and_connection() {
    let first = primary_runtime_port("launch-1", "connection-1");
    let second = primary_runtime_port("launch-1", "connection-1");
    assert_eq!(first, second);
}

#[tokio::test]
async fn runtime_port_lease_is_reused_and_released_by_launch_connection() {
    let unique = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let launch_id = format!("test_launch_{unique}");
    let connection_id = "connection-1";

    let first = lease_runtime_port(&launch_id, connection_id)
        .await
        .expect("runtime port should lease");
    let second = lease_runtime_port(&launch_id, connection_id)
        .await
        .expect("same runtime lease should be idempotent");
    assert_eq!(first, second);

    release_runtime_port(&launch_id, connection_id).await;
    assert!(!port_leases()
        .lock()
        .await
        .runtime
        .contains_key(&runtime_port_lease_key(&launch_id, connection_id)));
}

#[test]
fn port_lease_state_treats_setup_and_runtime_as_one_pool() {
    let mut leases = PortLeaseState::default();
    leases.setup.insert(49_321);
    leases
        .runtime
        .insert(runtime_port_lease_key("launch-1", "connection-1"), 49_322);

    assert!(leases.is_port_leased(49_321));
    assert!(leases.is_port_leased(49_322));
    assert!(!leases.is_port_leased(49_323));
}

#[test]
fn account_mismatch_does_not_preserve_recent_expected_credential() {
    assert_eq!(
        preserved_email_for_auth_error(
            &LocalMcpOAuthCode::AccountMismatch,
            Some("user@example.com"),
        ),
        None,
    );
    assert_eq!(
        preserved_email_for_auth_error(
            &LocalMcpOAuthCode::CredentialInvalid,
            Some("user@example.com"),
        ),
        Some("user@example.com"),
    );
}

#[tokio::test]
async fn start_auth_honors_preexisting_cancel_marker_before_launch() {
    let setup_id = format!(
        "test_cancel_{}",
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    );
    cancelled_setups().lock().await.insert(setup_id.clone());

    let error = start_google_workspace_mcp_auth(StartAuthInput {
        setup_id,
        user_google_email: None,
        oauth_client_id: "client.apps.googleusercontent.com".to_string(),
        oauth_client_secret: "secret".to_string(),
    })
    .await
    .expect_err("pre-cancelled setup should fail before launching uvx");

    assert_eq!(error.code, LocalMcpOAuthCode::Cancelled);
}
