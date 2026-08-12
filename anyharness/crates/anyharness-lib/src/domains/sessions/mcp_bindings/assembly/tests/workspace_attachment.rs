use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;
use crate::domains::sessions::mcp_bindings::workspace_attachment::WorkspaceMcpAttachmentPhase;

#[test]
fn workspace_selector_failure_remains_typed_and_bounded() {
    let catalog = ProductMcpLaunchCatalog::new(
        "http://127.0.0.1:4317".to_string(),
        None,
        vec![ProductMcpLaunchRegistration::new(
            &crate::domains::agent_operations::mcp::definition::DEFINITION,
            Arc::new(|_ctx| Err(anyhow::anyhow!("private selector detail"))),
            Arc::new(|_, _| Ok("unused".to_string())),
        )],
    );

    let error = assemble_session_mcp_launch(
        None,
        &[],
        &catalog,
        &workspace_record(),
        &session_record(),
        None,
    )
    .expect_err("Workspace selector failure must fail the launch");

    let SessionMcpLaunchAssemblyError::WorkspaceAttachment(error) = error else {
        panic!("Workspace selector failure must retain its typed boundary");
    };
    assert_eq!(error.phase(), WorkspaceMcpAttachmentPhase::Selection);
    assert!(!format!("{error:?}").contains("private selector detail"));
    assert!(!error.to_string().contains("private selector detail"));
}

#[test]
fn workspace_summary_assembly_failure_remains_typed() {
    let mut invalid_summary = summary("internal:workspace", "workspace");
    invalid_summary.id = "invalid Workspace id".to_string();
    let catalog = ProductMcpLaunchCatalog::new(
        "http://127.0.0.1:4317".to_string(),
        None,
        vec![ProductMcpLaunchRegistration::new(
            &crate::domains::agent_operations::mcp::definition::DEFINITION,
            Arc::new(|_ctx| Ok(true)),
            Arc::new(|_, _| Ok("workspace-token".to_string())),
        )
        .with_binding_summary(invalid_summary)],
    );

    let error = assemble_session_mcp_launch(
        None,
        &[],
        &catalog,
        &workspace_record(),
        &session_record(),
        None,
    )
    .expect_err("Workspace summary failure must fail the launch");

    let SessionMcpLaunchAssemblyError::WorkspaceAttachment(error) = error else {
        panic!("Workspace summary failure must retain its typed boundary");
    };
    assert_eq!(error.phase(), WorkspaceMcpAttachmentPhase::SummaryAssembly);
}

#[test]
fn workspace_token_failure_is_typed_and_a_later_launch_remints() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let attempt_counter = attempts.clone();
    let catalog = ProductMcpLaunchCatalog::new(
        "http://127.0.0.1:4317".to_string(),
        None,
        vec![ProductMcpLaunchRegistration::new(
            &crate::domains::agent_operations::mcp::definition::DEFINITION,
            Arc::new(|_ctx| Ok(true)),
            Arc::new(move |_, _| {
                if attempt_counter.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err(anyhow::anyhow!("private token detail"))
                } else {
                    Ok("retry-token".to_string())
                }
            }),
        )
        .with_applied_http_binding_summary()],
    );

    let first = assemble_session_mcp_launch(
        None,
        &[],
        &catalog,
        &workspace_record(),
        &session_record(),
        None,
    )
    .expect_err("first Workspace token mint must fail closed");
    let SessionMcpLaunchAssemblyError::WorkspaceAttachment(error) = first else {
        panic!("Workspace token failure must retain its typed boundary");
    };
    assert_eq!(error.phase(), WorkspaceMcpAttachmentPhase::TokenMint);
    assert!(!format!("{error:?}").contains("private token detail"));

    let retry = assemble_session_mcp_launch(
        None,
        &[],
        &catalog,
        &workspace_record(),
        &session_record(),
        None,
    )
    .expect("later explicit launch retries token mint");

    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    assert_eq!(retry.mcp_servers.len(), 1);
    assert!(retry
        .mcp_binding_summaries_json
        .as_deref()
        .is_some_and(|json| json.contains("internal:workspace")));
}

#[test]
fn successful_workspace_attachment_replaces_retired_subagents_summary() {
    let mut record = session_record();
    record.mcp_binding_summaries_json = serde_json::to_string(&vec![
        summary("user-server", "user"),
        summary("internal:subagents", "subagents"),
    ])
    .ok();
    let catalog = ProductMcpLaunchCatalog::new(
        "http://127.0.0.1:4317".to_string(),
        None,
        vec![ProductMcpLaunchRegistration::new(
            &crate::domains::agent_operations::mcp::definition::DEFINITION,
            Arc::new(|_ctx| Ok(true)),
            Arc::new(|_, _| Ok("workspace-token".to_string())),
        )
        .with_applied_http_binding_summary()],
    );

    let launch =
        assemble_session_mcp_launch(None, &[], &catalog, &workspace_record(), &record, None)
            .expect("replacement Workspace launch");
    let summaries: Vec<SessionMcpBindingSummary> = serde_json::from_str(
        launch
            .mcp_binding_summaries_json
            .as_deref()
            .expect("replacement summaries"),
    )
    .expect("parse replacement summaries");

    assert_eq!(
        summaries
            .iter()
            .map(|summary| summary.id.as_str())
            .collect::<Vec<_>>(),
        ["user-server", "internal:workspace"]
    );
}
