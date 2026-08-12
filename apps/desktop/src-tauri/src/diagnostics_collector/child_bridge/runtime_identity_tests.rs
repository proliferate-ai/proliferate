#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

use std::{
    os::unix::net::UnixStream,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use proliferate_diagnostics_client::bridge::{
    framing::{receive_frame, send_frame},
    wire::{ChildFrame, DeliveryFence, ParentFrame, WireComponent, CHILD_BRIDGE_PROTOCOL_VERSION},
};
use proliferate_diagnostics_client::{ProducerCollectorState, ProducerStatusSnapshot};
use proliferate_diagnostics_protocol::v1::{limits::MAX_SAFE_INTEGER, types::ComponentV1};

use super::{run_reader, BridgeShared, ChildBridgeConnection, ChildDiagnosticsBridge};

const PRODUCER_BOOT: &str = "producer-boot-identity";
const COLLECTOR_BOOT: &str = "collector-boot-identity";

fn bridge() -> (ChildDiagnosticsBridge, UnixStream) {
    let (parent, child) = UnixStream::pair().expect("socketpair");
    let reader_stream = parent.try_clone().expect("clone parent");
    let shared = Arc::new(BridgeShared::new(WireComponent::Anyharness, parent));
    shared.set_ready_collector(1, COLLECTOR_BOOT);
    let reader_shared = Arc::clone(&shared);
    let reader = thread::spawn(move || run_reader(reader_shared, reader_stream));
    let bridge = ChildDiagnosticsBridge {
        shared,
        supervisor: None,
        shutdown_signal: None,
        reader: Mutex::new(Some(reader)),
        generation_task: Mutex::new(None),
    };
    send_frame(
        &child,
        &ChildFrame::BootstrapAck {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            component: WireComponent::Anyharness,
            producer_boot_id: PRODUCER_BOOT.to_owned(),
        },
        &[],
    )
    .expect("ack");
    wait_for(|| bridge.connection() == ChildBridgeConnection::Connected);
    (bridge, child)
}

fn snapshot(collector_boot_id: &str, generation: u64) -> ProducerStatusSnapshot {
    ProducerStatusSnapshot {
        component: ComponentV1::Anyharness,
        producer_boot_id: PRODUCER_BOOT.to_owned(),
        last_assigned_sequence: Some(4),
        next_sequence: Some(5),
        collector_state: ProducerCollectorState::Ready {
            collector_boot_id: collector_boot_id.to_owned(),
            generation_number: generation,
        },
        resident_records: 0,
        resident_bytes: 0,
        in_flight: false,
        fallback_active: false,
        fallback_bytes: 0,
        fallback_write_failures: 0,
        dropped_by_reason: Default::default(),
        fallback_routed: 0,
        delivery_fence_eligible: true,
        last_failure: None,
    }
}

fn fence(collector_boot_id: &str, generation: u64) -> DeliveryFence {
    DeliveryFence {
        producer_boot_id: PRODUCER_BOOT.to_owned(),
        collector_boot_id: collector_boot_id.to_owned(),
        generation,
        last_assigned_sequence: Some(4),
    }
}

fn wait_for(condition: impl Fn() -> bool) {
    for _ in 0..400 {
        if condition() {
            return;
        }
        thread::sleep(Duration::from_millis(2));
    }
    panic!("condition did not become true");
}

#[tokio::test(flavor = "multi_thread")]
async fn generation_publication_cancels_the_old_pending_request() {
    let (bridge, mut child) = bridge();
    let bridge = Arc::new(bridge);
    let request_bridge = Arc::clone(&bridge);
    let request = tokio::spawn(async move { request_bridge.request_status().await });
    wait_for(|| {
        bridge
            .shared
            .state
            .lock()
            .expect("state")
            .status_slot
            .is_some()
    });
    let old = receive_frame::<ParentFrame>(&mut child).expect("old request");
    bridge.shared.set_ready_collector(2, "collector-boot-new");
    assert_eq!(request.await.expect("request task"), None);
    let ParentFrame::StatusRequest { request_id, .. } = old.frame else {
        panic!("expected status request");
    };
    send_frame(
        &child,
        &ChildFrame::StatusResponse {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            request_id,
            snapshot: snapshot(COLLECTOR_BOOT, 1),
        },
        &[],
    )
    .expect("late response");
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
}

#[tokio::test(flavor = "multi_thread")]
async fn same_generation_wrong_boot_rejects_the_whole_status_frame() {
    let (bridge, mut child) = bridge();
    let response = thread::spawn(move || {
        let request = receive_frame::<ParentFrame>(&mut child).expect("request");
        let ParentFrame::StatusRequest { request_id, .. } = request.frame else {
            panic!("expected status request");
        };
        send_frame(
            &child,
            &ChildFrame::StatusResponse {
                protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                request_id,
                snapshot: snapshot("collector-boot-wrong", 1),
            },
            &[],
        )
        .expect("response");
    });
    assert_eq!(bridge.request_status().await, None);
    response.join().expect("response thread");
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
}

#[tokio::test(flavor = "multi_thread")]
async fn cooldown_snapshot_cannot_prove_the_current_ready_identity() {
    let (bridge, mut child) = bridge();
    let response = thread::spawn(move || {
        let request = receive_frame::<ParentFrame>(&mut child).expect("request");
        let ParentFrame::StatusRequest { request_id, .. } = request.frame else {
            panic!("expected status request");
        };
        let mut unverifiable = snapshot(COLLECTOR_BOOT, 1);
        unverifiable.collector_state = ProducerCollectorState::Cooldown;
        send_frame(
            &child,
            &ChildFrame::StatusResponse {
                protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                request_id,
                snapshot: unverifiable,
            },
            &[],
        )
        .expect("response");
    });
    assert_eq!(bridge.request_status().await, None);
    response.join().expect("response thread");
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
}

#[tokio::test(flavor = "multi_thread")]
async fn snapshot_and_fence_identity_mismatch_rejects_the_whole_flush() {
    let (bridge, mut child) = bridge();
    let response = thread::spawn(move || {
        let request = receive_frame::<ParentFrame>(&mut child).expect("request");
        let ParentFrame::FlushRequest { request_id, .. } = request.frame else {
            panic!("expected flush request");
        };
        send_frame(
            &child,
            &ChildFrame::FlushResponse {
                protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                request_id,
                snapshot: snapshot(COLLECTOR_BOOT, 1),
                delivery_fence: Some(fence("collector-boot-wrong", 1)),
            },
            &[],
        )
        .expect("response");
    });
    assert_eq!(
        bridge
            .request_flush_until(tokio::time::Instant::now() + Duration::from_millis(200))
            .await,
        None
    );
    response.join().expect("response thread");
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
}

#[tokio::test(flavor = "multi_thread")]
async fn unsafe_integer_in_snapshot_loses_bridge_and_never_qualifies() {
    let (bridge, mut child) = bridge();
    let response = thread::spawn(move || {
        let request = receive_frame::<ParentFrame>(&mut child).expect("request");
        let ParentFrame::StatusRequest { request_id, .. } = request.frame else {
            panic!("expected status request");
        };
        let mut invalid = snapshot(COLLECTOR_BOOT, 1);
        invalid.fallback_routed = MAX_SAFE_INTEGER + 1;
        send_frame(
            &child,
            &ChildFrame::StatusResponse {
                protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                request_id,
                snapshot: invalid,
            },
            &[],
        )
        .expect("response");
    });
    assert_eq!(bridge.request_status().await, None);
    response.join().expect("response thread");
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
    assert_eq!(bridge.qualified_result(), None);
}

#[test]
fn clean_eof_preserves_terminal_but_generation_change_revokes_it() {
    let (bridge, child) = bridge();
    send_frame(
        &child,
        &ChildFrame::TerminalStatus {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            component: WireComponent::Anyharness,
            producer_boot_id: PRODUCER_BOOT.to_owned(),
            snapshot: snapshot(COLLECTOR_BOOT, 1),
            delivery_fence: Some(fence(COLLECTOR_BOOT, 1)),
        },
        &[],
    )
    .expect("terminal");
    wait_for(|| bridge.qualified_result().is_some());
    drop(child);
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
    assert!(bridge.qualified_result().is_some());
    bridge.shared.set_ready_collector(2, "collector-boot-new");
    assert_eq!(bridge.qualified_result(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn unexpected_eof_revokes_a_cached_completed_flush() {
    let (bridge, mut child) = bridge();
    let response = thread::spawn(move || {
        let request = receive_frame::<ParentFrame>(&mut child).expect("request");
        let ParentFrame::FlushRequest { request_id, .. } = request.frame else {
            panic!("expected flush request");
        };
        send_frame(
            &child,
            &ChildFrame::FlushResponse {
                protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
                request_id,
                snapshot: snapshot(COLLECTOR_BOOT, 1),
                delivery_fence: Some(fence(COLLECTOR_BOOT, 1)),
            },
            &[],
        )
        .expect("response");
        child
    });
    assert!(bridge
        .request_flush_until(tokio::time::Instant::now() + Duration::from_millis(200))
        .await
        .is_some());
    assert!(bridge.qualified_result().is_some());
    drop(response.join().expect("response thread"));
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
    assert_eq!(bridge.qualified_result(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn terminal_winning_before_flush_registration_sends_no_second_frame() {
    let (bridge, child) = bridge();
    send_frame(
        &child,
        &ChildFrame::TerminalStatus {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            component: WireComponent::Anyharness,
            producer_boot_id: PRODUCER_BOOT.to_owned(),
            snapshot: snapshot(COLLECTOR_BOOT, 1),
            delivery_fence: Some(fence(COLLECTOR_BOOT, 1)),
        },
        &[],
    )
    .expect("terminal");
    wait_for(|| bridge.qualified_result().is_some());

    assert_eq!(
        bridge
            .request_flush_until(tokio::time::Instant::now() + Duration::from_millis(50))
            .await,
        None
    );
    child
        .set_read_timeout(Some(Duration::from_millis(20)))
        .expect("read timeout");
    let mut child = child;
    assert!(receive_frame::<ParentFrame>(&mut child).is_err());
    drop(child);
    wait_for(|| bridge.connection() == ChildBridgeConnection::Lost);
    assert!(bridge.qualified_result().is_some());
}
