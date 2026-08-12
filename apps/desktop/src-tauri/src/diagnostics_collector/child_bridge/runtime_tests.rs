#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Deterministic parent-runtime proofs over a plain socketpair. The test
//! plays the child with the shared client framing; no supervisor, bootstrap,
//! or spawned binary is involved.

use std::{
    io::Read,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    os::unix::net::UnixStream,
    sync::{atomic::AtomicBool, Arc, Mutex},
    thread,
    time::Duration,
};

use proliferate_diagnostics_client::bridge::{
    framing::{receive_frame, send_frame},
    wire::{ChildFrame, DeliveryFence, ParentFrame, WireComponent, CHILD_BRIDGE_PROTOCOL_VERSION},
};
use proliferate_diagnostics_protocol::v1::types::ComponentV1;

use super::{
    run_reader, BridgeShared, ChildBridgeConnection, ChildDiagnosticsBridge, ChildProcessPresence,
    ProducerStatusSnapshot,
};

const PRODUCER_BOOT: &str = "producer-boot-1";
const COLLECTOR_BOOT: &str = "collector-boot-1";

fn start_bridge(component: WireComponent) -> (ChildDiagnosticsBridge, UnixStream) {
    let (parent, child) = UnixStream::pair().expect("socketpair");
    let reader_stream = parent.try_clone().expect("clone bridge stream");
    let shared = Arc::new(BridgeShared::new(component, parent));
    let reader_shared = Arc::clone(&shared);
    let reader = thread::spawn(move || run_reader(reader_shared, reader_stream));
    let bridge = ChildDiagnosticsBridge {
        shared,
        supervisor: None,
        shutdown_writer: None,
        shutdown_signaled: AtomicBool::new(false),
        reader: Mutex::new(Some(reader)),
        generation_task: Mutex::new(None),
    };
    (bridge, child)
}

fn snapshot(component: ComponentV1, producer_boot_id: &str) -> ProducerStatusSnapshot {
    ProducerStatusSnapshot {
        component,
        producer_boot_id: producer_boot_id.to_owned(),
        last_assigned_sequence: Some(4),
        next_sequence: Some(5),
        collector_state: proliferate_diagnostics_client::ProducerCollectorState::Ready {
            collector_boot_id: COLLECTOR_BOOT.to_owned(),
            generation_number: 1,
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

fn fence(producer_boot_id: &str, generation: u64) -> DeliveryFence {
    DeliveryFence {
        producer_boot_id: producer_boot_id.to_owned(),
        collector_boot_id: COLLECTOR_BOOT.to_owned(),
        generation,
        last_assigned_sequence: Some(4),
    }
}

fn send_ack(child: &UnixStream, component: WireComponent, producer_boot_id: &str) {
    let ack = ChildFrame::BootstrapAck {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component,
        producer_boot_id: producer_boot_id.to_owned(),
    };
    send_frame(child, &ack, &[]).expect("send bootstrap ack");
}

fn wait_for(what: &str, condition: impl Fn() -> bool) {
    for _ in 0..400 {
        if condition() {
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }
    panic!("timed out waiting for {what}");
}

fn wait_connection(bridge: &ChildDiagnosticsBridge, expected: ChildBridgeConnection) {
    wait_for("bridge connection state", || {
        bridge.connection() == expected
    });
}

fn connect(component: WireComponent) -> (ChildDiagnosticsBridge, UnixStream) {
    let (bridge, child) = start_bridge(component);
    send_ack(&child, component, PRODUCER_BOOT);
    wait_connection(&bridge, ChildBridgeConnection::Connected);
    (bridge, child)
}

/// Reads one status request off the child endpoint and answers it.
fn answer_status(
    mut child: UnixStream,
    snapshot: ProducerStatusSnapshot,
) -> thread::JoinHandle<UnixStream> {
    thread::spawn(move || {
        let received = receive_frame::<ParentFrame>(&mut child).expect("parent frame");
        assert!(received.descriptors.is_empty());
        let ParentFrame::StatusRequest { request_id, .. } = received.frame else {
            panic!("expected status request, got {:?}", received.frame);
        };
        let response = ChildFrame::StatusResponse {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            request_id,
            snapshot,
        };
        send_frame(&child, &response, &[]).expect("send status response");
        child
    })
}

/// Reads one flush request off the child endpoint and answers it.
fn answer_flush(
    mut child: UnixStream,
    snapshot: ProducerStatusSnapshot,
    delivery_fence: Option<DeliveryFence>,
) -> thread::JoinHandle<(UnixStream, u64)> {
    thread::spawn(move || {
        let received = receive_frame::<ParentFrame>(&mut child).expect("parent frame");
        let ParentFrame::FlushRequest {
            request_id,
            remaining_deadline_ms,
            ..
        } = received.frame
        else {
            panic!("expected flush request, got {:?}", received.frame);
        };
        let response = ChildFrame::FlushResponse {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            request_id,
            snapshot,
            delivery_fence,
        };
        send_frame(&child, &response, &[]).expect("send flush response");
        (child, remaining_deadline_ms)
    })
}

#[test]
fn bootstrap_ack_connects_and_records_producer_boot() {
    let (bridge, _child) = connect(WireComponent::Anyharness);
    assert_eq!(
        bridge.acknowledged_producer_boot().as_deref(),
        Some(PRODUCER_BOOT)
    );
}

#[test]
fn mismatched_component_ack_loses_bridge() {
    let (bridge, child) = start_bridge(WireComponent::Anyharness);
    send_ack(&child, WireComponent::DesktopWorker, PRODUCER_BOOT);
    wait_connection(&bridge, ChildBridgeConnection::Lost);
    assert_eq!(bridge.acknowledged_producer_boot(), None);
}

#[test]
fn duplicate_bootstrap_ack_loses_bridge() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    send_ack(&child, WireComponent::Anyharness, PRODUCER_BOOT);
    wait_connection(&bridge, ChildBridgeConnection::Lost);
}

#[test]
fn unsolicited_status_response_loses_bridge() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    let response = ChildFrame::StatusResponse {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id: 1,
        snapshot: snapshot(ComponentV1::Anyharness, PRODUCER_BOOT),
    };
    send_frame(&child, &response, &[]).expect("send unsolicited response");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
}

#[test]
fn descriptor_rights_on_child_frame_lose_bridge() {
    let (bridge, child) = start_bridge(WireComponent::Anyharness);
    let (extra, _keep) = UnixStream::pair().expect("extra descriptor pair");
    let ack = ChildFrame::BootstrapAck {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        producer_boot_id: PRODUCER_BOOT.to_owned(),
    };
    send_frame(&child, &ack, &[extra.as_raw_fd()]).expect("send frame with rights");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
}

#[test]
fn child_endpoint_close_loses_bridge() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    drop(child);
    wait_connection(&bridge, ChildBridgeConnection::Lost);
}

#[tokio::test(flavor = "multi_thread")]
async fn status_request_round_trips_within_deadline() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    let expected = snapshot(ComponentV1::Anyharness, PRODUCER_BOOT);
    let responder = answer_status(child, expected.clone());
    let result = bridge.request_status().await;
    assert_eq!(result, Some(expected));
    responder.join().expect("responder");
    assert_eq!(bridge.connection(), ChildBridgeConnection::Connected);
}

#[tokio::test(flavor = "multi_thread")]
async fn status_request_before_activation_is_unavailable() {
    let (bridge, _child) = start_bridge(WireComponent::Anyharness);
    assert_eq!(bridge.request_status().await, None);
}

#[tokio::test(flavor = "multi_thread")]
async fn status_timeout_cancels_slot_and_late_reply_fails_closed() {
    let (bridge, mut child) = connect(WireComponent::Anyharness);
    assert_eq!(bridge.request_status().await, None);
    let received = receive_frame::<ParentFrame>(&mut child).expect("parent frame");
    let ParentFrame::StatusRequest { request_id, .. } = received.frame else {
        panic!("expected status request");
    };
    let late = ChildFrame::StatusResponse {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        request_id,
        snapshot: snapshot(ComponentV1::Anyharness, PRODUCER_BOOT),
    };
    send_frame(&child, &late, &[]).expect("send late response");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
}

#[tokio::test(flavor = "multi_thread")]
async fn second_concurrent_status_request_is_refused_by_the_single_slot() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    let bridge = Arc::new(bridge);
    let first_bridge = Arc::clone(&bridge);
    let first = tokio::spawn(async move { first_bridge.request_status().await });
    wait_for("first request dispatched", || {
        bridge
            .shared
            .state
            .lock()
            .expect("state lock")
            .status_slot
            .is_some()
    });
    assert_eq!(bridge.request_status().await, None);
    let expected = snapshot(ComponentV1::Anyharness, PRODUCER_BOOT);
    let responder = answer_status(child, expected.clone());
    assert_eq!(first.await.expect("first request"), Some(expected));
    responder.join().expect("responder");
}

#[tokio::test(flavor = "multi_thread")]
async fn flush_round_trip_keeps_matching_fence_and_caps_deadline() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    bridge.shared.set_current_generation(7);
    let expected = snapshot(ComponentV1::Anyharness, PRODUCER_BOOT);
    let matching = fence(PRODUCER_BOOT, 7);
    let responder = answer_flush(child, expected.clone(), Some(matching.clone()));
    let result = bridge
        .request_flush(Duration::from_secs(30))
        .await
        .expect("flush result");
    assert_eq!(result.snapshot, expected);
    assert_eq!(result.delivery_fence, Some(matching));
    let (_child, remaining_deadline_ms) = responder.join().expect("responder");
    assert_eq!(remaining_deadline_ms, super::MAX_CHILD_FLUSH_DEADLINE_MS);
}

#[tokio::test(flavor = "multi_thread")]
async fn flush_fence_with_stale_generation_is_dropped_but_snapshot_kept() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    bridge.shared.set_current_generation(7);
    let expected = snapshot(ComponentV1::Anyharness, PRODUCER_BOOT);
    let responder = answer_flush(child, expected.clone(), Some(fence(PRODUCER_BOOT, 6)));
    let result = bridge
        .request_flush(Duration::from_millis(200))
        .await
        .expect("flush result");
    assert_eq!(result.snapshot, expected);
    assert_eq!(result.delivery_fence, None);
    let (_child, remaining_deadline_ms) = responder.join().expect("responder");
    assert_eq!(remaining_deadline_ms, 200);
    assert_eq!(bridge.connection(), ChildBridgeConnection::Connected);
}

#[test]
fn terminal_status_is_cached_at_most_once() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    bridge.shared.set_current_generation(3);
    let terminal_snapshot = snapshot(ComponentV1::Anyharness, PRODUCER_BOOT);
    let terminal = ChildFrame::TerminalStatus {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        producer_boot_id: PRODUCER_BOOT.to_owned(),
        snapshot: terminal_snapshot.clone(),
        delivery_fence: Some(fence(PRODUCER_BOOT, 3)),
    };
    send_frame(&child, &terminal, &[]).expect("send terminal");
    wait_for("terminal cached", || bridge.terminal_result().is_some());
    send_frame(&child, &terminal, &[]).expect("send duplicate terminal");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
    let cached = bridge.terminal_result().expect("first terminal retained");
    assert_eq!(cached.snapshot, terminal_snapshot);
    assert_eq!(cached.delivery_fence, Some(fence(PRODUCER_BOOT, 3)));
}

#[test]
fn pre_bootstrap_terminal_is_rejected() {
    let (bridge, child) = start_bridge(WireComponent::Anyharness);
    let terminal = ChildFrame::TerminalStatus {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        producer_boot_id: PRODUCER_BOOT.to_owned(),
        snapshot: snapshot(ComponentV1::Anyharness, PRODUCER_BOOT),
        delivery_fence: None,
    };
    send_frame(&child, &terminal, &[]).expect("send terminal");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
    assert_eq!(bridge.terminal_result(), None);
}

#[test]
fn wrong_boot_terminal_is_rejected() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    let terminal = ChildFrame::TerminalStatus {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        producer_boot_id: "some-other-boot".to_owned(),
        snapshot: snapshot(ComponentV1::Anyharness, "some-other-boot"),
        delivery_fence: None,
    };
    send_frame(&child, &terminal, &[]).expect("send terminal");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
    assert_eq!(bridge.terminal_result(), None);
}

#[test]
fn wrong_generation_terminal_fence_rejects_whole_frame() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    bridge.shared.set_current_generation(3);
    let terminal = ChildFrame::TerminalStatus {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        producer_boot_id: PRODUCER_BOOT.to_owned(),
        snapshot: snapshot(ComponentV1::Anyharness, PRODUCER_BOOT),
        delivery_fence: Some(fence(PRODUCER_BOOT, 2)),
    };
    send_frame(&child, &terminal, &[]).expect("send terminal");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
    assert_eq!(bridge.terminal_result(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn terminal_after_completed_flush_is_rejected() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    bridge.shared.set_current_generation(1);
    let flushed = snapshot(ComponentV1::Anyharness, PRODUCER_BOOT);
    let responder = answer_flush(child, flushed, None);
    bridge
        .request_flush(Duration::from_millis(300))
        .await
        .expect("flush result");
    let (child, _) = responder.join().expect("responder");
    let terminal = ChildFrame::TerminalStatus {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        component: WireComponent::Anyharness,
        producer_boot_id: PRODUCER_BOOT.to_owned(),
        snapshot: snapshot(ComponentV1::Anyharness, PRODUCER_BOOT),
        delivery_fence: None,
    };
    send_frame(&child, &terminal, &[]).expect("send terminal");
    wait_connection(&bridge, ChildBridgeConnection::Lost);
    assert_eq!(bridge.terminal_result(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn diagnostics_state_reports_valid_producer_snapshot() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    let expected = snapshot(ComponentV1::Anyharness, PRODUCER_BOOT);
    let responder = answer_status(child, expected.clone());
    let state = bridge
        .diagnostics_state(ChildProcessPresence::Running)
        .await;
    assert_eq!(state.process, ChildProcessPresence::Running);
    assert_eq!(state.bridge, ChildBridgeConnection::Connected);
    assert_eq!(state.producer, Some(expected));
    responder.join().expect("responder");
}

#[tokio::test(flavor = "multi_thread")]
async fn diagnostics_state_discards_mismatched_snapshot() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    let wrong_component = snapshot(ComponentV1::DesktopWorker, PRODUCER_BOOT);
    let responder = answer_status(child, wrong_component);
    let state = bridge
        .diagnostics_state(ChildProcessPresence::Running)
        .await;
    assert_eq!(state.producer, None);
    responder.join().expect("responder");
}

#[tokio::test(flavor = "multi_thread")]
async fn diagnostics_state_skips_status_for_missing_process() {
    let (bridge, _child) = connect(WireComponent::Anyharness);
    let state = bridge
        .diagnostics_state(ChildProcessPresence::Missing)
        .await;
    assert_eq!(state.process, ChildProcessPresence::Missing);
    assert_eq!(state.bridge, ChildBridgeConnection::Connected);
    assert_eq!(state.producer, None);
}

#[test]
fn signal_shutdown_writes_exactly_one_byte() {
    let (mut bridge, _child) = connect(WireComponent::Anyharness);
    let mut pipe_ends = [0_i32; 2];
    // SAFETY: `pipe_ends` is a valid two-element output array.
    assert_eq!(unsafe { libc::pipe(pipe_ends.as_mut_ptr()) }, 0);
    // SAFETY: both descriptors were just returned by `pipe` and are unowned.
    let (read_end, write_end) = unsafe {
        (
            OwnedFd::from_raw_fd(pipe_ends[0]),
            OwnedFd::from_raw_fd(pipe_ends[1]),
        )
    };
    bridge.shutdown_writer = Some(write_end);
    bridge.signal_shutdown();
    bridge.signal_shutdown();
    drop(bridge);
    let mut drained = Vec::new();
    let mut reader = std::fs::File::from(read_end);
    reader.read_to_end(&mut drained).expect("drain pipe");
    assert_eq!(drained, vec![1_u8]);
}

#[test]
fn stop_is_idempotent_and_joins_the_reader() {
    let (bridge, child) = connect(WireComponent::Anyharness);
    bridge.stop();
    bridge.stop();
    drop(child);
    assert!(bridge.reader.lock().expect("reader lock").is_none());
}
