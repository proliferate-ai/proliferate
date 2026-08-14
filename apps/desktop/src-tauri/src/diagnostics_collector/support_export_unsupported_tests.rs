use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::sync::watch;
use tokio::time::{Duration, Instant};

use super::tests::{FROM, TO};
use super::*;

fn invocation_with_probe() -> (SupportExportInvocation, Arc<AtomicUsize>) {
    let mut invocation = issue_support_export_for_coordinator(
        &uuid::Uuid::new_v4().to_string(),
        FROM.to_string(),
        TO.to_string(),
        Instant::now() + Duration::from_secs(25),
    )
    .expect("support invocation");
    let drops = Arc::new(AtomicUsize::new(0));
    invocation.permit.drop_probe = Some(AuthorityDropProbe(Arc::clone(&drops)));
    (invocation, drops)
}

fn assert_error(
    result: Result<ValidatedSupportExport, SupportExportError>,
    expected: SupportExportError,
) {
    match result {
        Err(actual) => assert_eq!(actual, expected),
        Ok(_) => panic!("unsupported support export unexpectedly succeeded"),
    }
}

#[tokio::test]
async fn unsupported_path_preserves_authority_cancellation_busy_and_platform_precedence() {
    let admission = ExportAdmission::shared_capacity_one();
    let broker_permit = Arc::clone(&admission)
        .try_acquire_owned()
        .expect("broker owns shared export slot");

    let (mut invocation, drops) = invocation_with_probe();
    invocation.request.collector.record_limit -= 1;
    let (cancel_tx, cancel_rx) = watch::channel(true);
    assert_error(
        unsupported_support_export(Arc::clone(&admission), invocation, cancel_rx).await,
        SupportExportError::InvalidAuthority,
    );
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    drop(cancel_tx);

    let (invocation, drops) = invocation_with_probe();
    let (cancel_tx, cancel_rx) = watch::channel(true);
    assert_error(
        unsupported_support_export(Arc::clone(&admission), invocation, cancel_rx).await,
        SupportExportError::Cancelled,
    );
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    drop(cancel_tx);

    let (invocation, drops) = invocation_with_probe();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    assert_error(
        unsupported_support_export(Arc::clone(&admission), invocation, cancel_rx).await,
        SupportExportError::Busy,
    );
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    drop(cancel_tx);

    drop(broker_permit);
    let (invocation, drops) = invocation_with_probe();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    assert_error(
        unsupported_support_export(Arc::clone(&admission), invocation, cancel_rx).await,
        SupportExportError::Unsupported,
    );
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    drop(cancel_tx);

    let (invocation, drops) = invocation_with_probe();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    drop(cancel_tx);
    assert_error(
        unsupported_support_export(admission, invocation, cancel_rx).await,
        SupportExportError::Cancelled,
    );
    assert_eq!(drops.load(Ordering::SeqCst), 1);
}
