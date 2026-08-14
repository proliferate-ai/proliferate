use tokio::sync::watch;
use tokio::time::{Duration, Instant};

use super::supervisor::DiagnosticsCollectorSupervisor;
use super::support_export::{
    issue_support_export_for_coordinator, SupportExportError, ValidatedSupportExport,
};

const FROM: &str = "2026-08-10T13:45:00.000Z";
const TO: &str = "2026-08-10T14:00:00.000Z";

async fn minimal_support_snapshot_coordinator(
    supervisor: &DiagnosticsCollectorSupervisor,
    preparation_id: &str,
    cancellation: watch::Receiver<bool>,
) -> Result<ValidatedSupportExport, SupportExportError> {
    let invocation = issue_support_export_for_coordinator(
        preparation_id,
        FROM.to_string(),
        TO.to_string(),
        Instant::now() + Duration::from_secs(25),
    )?;
    supervisor
        .export_support_snapshot(invocation, cancellation)
        .await
}

#[test]
fn sibling_coordinator_reaches_the_fixed_opaque_issuance_seam() {
    let invocation = issue_support_export_for_coordinator(
        &uuid::Uuid::new_v4().to_string(),
        FROM.to_string(),
        TO.to_string(),
        Instant::now() + Duration::from_secs(25),
    );
    assert!(invocation.is_ok());
    let _compile_shaped_coordinator = minimal_support_snapshot_coordinator;
}
