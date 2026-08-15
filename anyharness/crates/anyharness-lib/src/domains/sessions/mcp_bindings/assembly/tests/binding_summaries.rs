//! Binding-summary merge and validation, split out of `assembly.rs`'s
//! inline tests to keep that file under the size ceiling.

use super::*;

#[test]
fn assemble_launch_merges_existing_and_extension_binding_summaries_in_order() {
    let mut record = session_record();
    record.mcp_binding_summaries_json =
        serde_json::to_string(&vec![summary("user-1", "user")]).ok();
    let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
        extras: SessionLaunchExtras {
            mcp_binding_summaries: vec![summary("product-1", "product")],
            ..SessionLaunchExtras::default()
        },
    });

    let assembled = assemble_session_mcp_launch(
        None,
        &[extension],
        &ProductMcpLaunchCatalog::disabled(),
        &workspace_record(),
        &record,
        None,
    )
    .expect("assemble launch");
    let summaries: Vec<SessionMcpBindingSummary> =
        serde_json::from_str(&assembled.mcp_binding_summaries_json.expect("summaries"))
            .expect("parse summaries");

    assert_eq!(summaries.len(), 2);
    assert_eq!(summaries[0].id, "user-1");
    assert_eq!(summaries[1].id, "product-1");
}

#[test]
fn assemble_launch_rejects_invalid_extension_binding_summary() {
    let mut invalid_summary = summary("product-1", "product");
    invalid_summary.id = "product binding".to_string();
    let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
        extras: SessionLaunchExtras {
            mcp_binding_summaries: vec![invalid_summary],
            ..SessionLaunchExtras::default()
        },
    });

    let error = assemble_session_mcp_launch(
        None,
        &[extension],
        &ProductMcpLaunchCatalog::disabled(),
        &workspace_record(),
        &session_record(),
        None,
    )
    .expect_err("invalid summary");

    assert!(matches!(error, SessionMcpLaunchAssemblyError::Internal(_)));
}
