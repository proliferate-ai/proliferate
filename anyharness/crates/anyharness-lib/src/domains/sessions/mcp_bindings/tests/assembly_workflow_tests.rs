use super::*;

#[test]
fn workflow_overlay_is_exact_and_interactive_restoration_is_unchanged() {
    let cipher = sample_cipher();
    let remote_gateway = http_server("integration-gateway", "remote-gateway");
    let mut unrelated_product = http_server("product-runtime", "unrelated-product");
    if let SessionMcpServer::Http(server) = &mut unrelated_product {
        server.headers[0].value = "Bearer runtime-bearer-canary".to_string();
        server.headers.push(SessionMcpHeader {
            name: "x-proliferate-product-mcp-token".to_string(),
            value: "product-capability-canary".to_string(),
        });
    }
    let mut record = session_record();
    record.mcp_bindings_ciphertext = Some(
        encrypt_bindings(Some(&cipher), std::slice::from_ref(&remote_gateway))
            .expect("encrypt persisted binding")
            .expect("persisted ciphertext"),
    );
    let original_ciphertext = record.mcp_bindings_ciphertext.clone();
    let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
        extras: SessionLaunchExtras {
            mcp_servers: vec![remote_gateway, unrelated_product],
            ..SessionLaunchExtras::default()
        },
    });
    let extensions = [extension];
    let persisted_interactive_prompt = Some(
        "Use Product MCP remote-gateway with INTERACTIVE_PROMPT_CREDENTIAL_CANARY".to_string(),
    );
    let interactive_before = assemble_session_mcp_launch(
        Some(&cipher),
        &extensions,
        &ProductMcpLaunchCatalog::disabled(),
        &workspace_record(),
        &record,
        persisted_interactive_prompt.clone(),
    )
    .expect("interactive assembly before takeover");
    let local = workflow_gateway_server(
        &TrustedLocalGatewayBinding::try_new(
            "http://127.0.0.1:43891/mcp",
            "session-1",
            7,
            11,
            "local-broker-capability",
        )
        .expect("local binding"),
    );
    let workflow = assemble_workflow_session_mcp_launch(local.clone());

    assert_eq!(workflow.mcp_servers, vec![local]);
    let serialized = serde_json::to_string(&workflow.mcp_servers).expect("serialize overlay");
    for canary in [
        "https://remote-gateway.example.com/mcp",
        "Authorization",
        "Bearer secret",
        "runtime-bearer-canary",
        "product-capability-canary",
        "product-runtime",
        "unrelated-product",
        "Use Product MCP",
        "INTERACTIVE_PROMPT_CREDENTIAL_CANARY",
    ] {
        assert!(
            !serialized.contains(canary)
                && !workflow
                    .system_prompt_append
                    .as_deref()
                    .unwrap_or_default()
                    .contains(canary)
                && !workflow
                    .first_prompt_system_prompt_append
                    .as_deref()
                    .unwrap_or_default()
                    .contains(canary),
            "workflow leaked {canary}"
        );
    }
    assert!(workflow.mcp_binding_summaries_json.is_none());
    assert_eq!(record.mcp_bindings_ciphertext, original_ciphertext);

    let interactive_after = assemble_session_mcp_launch(
        Some(&cipher),
        &extensions,
        &ProductMcpLaunchCatalog::disabled(),
        &workspace_record(),
        &record,
        persisted_interactive_prompt,
    )
    .expect("interactive assembly after rollback");
    assert_eq!(
        interactive_after.mcp_servers,
        interactive_before.mcp_servers
    );
    assert_eq!(
        interactive_after.system_prompt_append,
        interactive_before.system_prompt_append
    );
    assert_eq!(record.mcp_bindings_ciphertext, original_ciphertext);
}
