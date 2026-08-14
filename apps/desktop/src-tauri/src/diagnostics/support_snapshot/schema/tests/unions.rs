use crate::diagnostics::support_snapshot::schema::model::evidence::SupportFallbackComponentV1;
use crate::diagnostics::support_snapshot::schema::model::health::{
    DesktopDiagnosticsSupervisorStateV1, SupportChildCollectorStateV1,
    SupportChildProducerStatusV1, SupportTauriProducerHealthV1,
};
use crate::diagnostics::support_snapshot::schema::model::manifest::SupportSessionCollectionManifestV1;

#[test]
fn every_support_tagged_union_denies_unknown_fields() {
    assert!(serde_json::from_str::<SupportFallbackComponentV1>(
        r#"{"family":"pr3_desktop_native_mixed","records":[],"opaqueLines":[],"extra":true}"#
    )
    .is_err());
    assert!(serde_json::from_str::<DesktopDiagnosticsSupervisorStateV1>(
        r#"{"state":"stopped","orderly":true,"extra":0}"#
    )
    .is_err());
    assert!(serde_json::from_str::<SupportChildCollectorStateV1>(
        r#"{"kind":"unavailable","extra":0}"#
    )
    .is_err());
    assert!(serde_json::from_str::<SupportChildProducerStatusV1>(
        r#"{"state":"omitted","capturedAt":"2026-08-12T00:00:00Z","reason":"child_missing","extra":0}"#
    )
    .is_err());
    assert!(serde_json::from_str::<SupportTauriProducerHealthV1>(
        r#"{"state":"omitted","reason":"producer_status_unavailable","extra":0}"#
    )
    .is_err());
    assert!(serde_json::from_str::<SupportSessionCollectionManifestV1>(
        r#"{"state":"omitted","reason":"session_timeout","extra":0}"#
    )
    .is_err());
}

#[test]
fn every_support_tagged_union_still_accepts_its_exact_shape() {
    serde_json::from_str::<SupportFallbackComponentV1>(
        r#"{"family":"pr3_desktop_native_mixed","records":[],"opaqueLines":[]}"#,
    )
    .expect("fallback union");
    serde_json::from_str::<DesktopDiagnosticsSupervisorStateV1>(
        r#"{"state":"stopped","orderly":true}"#,
    )
    .expect("supervisor union");
    serde_json::from_str::<SupportChildCollectorStateV1>(r#"{"kind":"unavailable"}"#)
        .expect("collector-state union");
    serde_json::from_str::<SupportChildProducerStatusV1>(
        r#"{"state":"omitted","capturedAt":"2026-08-12T00:00:00Z","reason":"child_missing"}"#,
    )
    .expect("child-status union");
    serde_json::from_str::<SupportTauriProducerHealthV1>(
        r#"{"state":"omitted","reason":"producer_status_unavailable"}"#,
    )
    .expect("Tauri-health union");
    serde_json::from_str::<SupportSessionCollectionManifestV1>(
        r#"{"state":"omitted","reason":"session_timeout"}"#,
    )
    .expect("session-collection union");
}
