//! End-to-end fd-bridge reattach proof for a bundled/prod producer.
//!
//! The other generation tests call `replace_generation` in-process. These
//! drive the real `BridgeRuntime` over a `UnixStream` pair with real
//! `ParentFrame::GenerationReady` frames whose capability crosses as an
//! `SCM_RIGHTS` descriptor, exactly as the Desktop parent's
//! `run_generation_task` sends it. The claim under proof is the incident's
//! self-heal: after the collector generation advances on the wire, the
//! producer delivers to the new collector and the abandoned queue is routed
//! as `generation_changed` rather than going silent.
//!
//! Manual acceptance on a packaged app (the flow this approximates):
//! 1. Launch the bundled Desktop app and let a runtime attach over the fd
//!    bridge; confirm runtime records land in the collector (Honeycomb or the
//!    local records query) carrying the current `collector_boot_id`.
//! 2. Find the collector child pid (`pgrep -f proliferate-diagnostics-collector`)
//!    and `kill -9` it.
//! 3. Watch the supervisor restart it: `anyharness.log` shows
//!    `desktop.collector.restart` and the supervisor state advances to a new
//!    `collector_boot_id` with `restart_count` incremented.
//! 4. Confirm runtime records keep flowing under the NEW `collector_boot_id`
//!    (not silence), and that the diagnostics fallback file records the
//!    in-flight/queued survivors with reason `generation_changed` /
//!    `delivery_unknown`. No further operator action should be required.

use std::{
    io::Write,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    os::unix::net::UnixStream,
    sync::Arc,
    time::{Duration, Instant},
};

use proliferate_diagnostics_protocol::v1::{
    limits::CURRENT_SCHEMA_VERSION,
    types::{ConnectionDescriptorV1, ProtectedTokenReferenceV1, TokenReferenceKindV1},
};

use super::{
    status::ProducerCollectorState,
    tests_support::{
        accepted_receipt, drained, emit, fallback_bytes, fallback_directory, fallback_writer,
        ordinary, protected, settle, spawn_worker, wait_for, CollectorFixture, FixtureResponse,
        TEST_CAPABILITY,
    },
    CollectorAvailability,
};
use crate::{
    bridge::{
        framing::{receive_frame, send_frame_until},
        wire::{
            CapabilityFdRole, ChildFrame, ParentFrame, CHILD_BOOTSTRAP_READ_DEADLINE,
            CHILD_BRIDGE_PROTOCOL_VERSION,
        },
    },
    DiagnosticsComponent, EmitDisposition,
};

const OLD_COLLECTOR_BOOT: &str = "collector-boot-reattach-1";
const NEW_COLLECTOR_BOOT: &str = "collector-boot-reattach-2";

fn shutdown_reader() -> (OwnedFd, OwnedFd) {
    let mut descriptors = [0_i32; 2];
    assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
    unsafe {
        (
            OwnedFd::from_raw_fd(descriptors[0]),
            OwnedFd::from_raw_fd(descriptors[1]),
        )
    }
}

/// One `SCM_RIGHTS` capability channel carrying `TEST_CAPABILITY`, mirroring
/// the supervisor's `protected_child_handoff`: the token bytes plus a
/// terminating newline are written into one end of a `UnixStream` pair and the
/// other end crosses the bridge as the descriptor `read_capability_until`
/// consumes. Callers keep both ends alive until the frame is consumed — see
/// the same-process externalization note at the first `GenerationReady` send.
fn capability_channel() -> (UnixStream, UnixStream) {
    let (mut writer, inherited) = UnixStream::pair().expect("capability pair");
    writer
        .write_all(TEST_CAPABILITY.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .expect("capability bytes");
    (writer, inherited)
}

/// A `ParentFrame::GenerationReady` for `endpoint`/`boot_id` at `generation`.
/// The endpoint drops the fixture's trailing slash so it satisfies the
/// connection-descriptor validator; the token reference is a placeholder the
/// child overwrites with the received descriptor number.
fn generation_ready(
    generation: u64,
    endpoint: &str,
    boot_id: &str,
    capability_fd: i32,
) -> ParentFrame {
    ParentFrame::GenerationReady {
        protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
        generation,
        descriptor: ConnectionDescriptorV1 {
            endpoint: endpoint.trim_end_matches('/').to_owned(),
            token_reference: ProtectedTokenReferenceV1 {
                kind: TokenReferenceKindV1::InheritedFileDescriptor,
                reference: capability_fd.to_string(),
            },
            schema_major: CURRENT_SCHEMA_VERSION.major,
            collector_boot_id: boot_id.to_owned(),
        },
        capability_fd_role: CapabilityFdRole::CollectorCapability,
    }
}

/// Reasons written to the component fallback file, oldest first.
fn fallback_reasons(directory: &tempfile::TempDir) -> Vec<String> {
    fallback_bytes(directory, "anyharness.jsonl")
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let value: serde_json::Value =
                serde_json::from_slice(line).expect("fallback JSON line");
            value["reason"].as_str().expect("string reason").to_owned()
        })
        .collect()
}

/// A wire `GenerationReady` reattaches the producer to a strictly newer
/// collector: work already delivered stays with the old collector, work still
/// resident at the swap is routed (`generation_changed` when queued,
/// `delivery_unknown` when the dispatched request is cancelled), and fresh
/// records dispatch to the new fixture. A subsequent stale frame is ignored.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wire_generation_ready_reattaches_and_routes_the_abandoned_queue() {
    // The old collector stalls every request past the transport deadline: the
    // first record still crosses the dispatch boundary (the fixture records
    // the batch), which pins it in flight so later records queue behind it.
    let old = CollectorFixture::start(OLD_COLLECTOR_BOOT, |_, batch| {
        FixtureResponse::Delayed(
            Duration::from_secs(5),
            accepted_receipt(OLD_COLLECTOR_BOOT, batch.records.len()),
        )
    })
    .await;
    let new = CollectorFixture::accepting(NEW_COLLECTOR_BOOT).await;
    let directory = fallback_directory();
    let inner = super::tests_support::producer(
        DiagnosticsComponent::AnyHarness,
        CollectorAvailability::Ready(Arc::new(old.generation(1))),
        Some(fallback_writer(
            &directory,
            DiagnosticsComponent::AnyHarness,
        )),
    );

    // Boot the producer over the real fd bridge for generation 1 (old fixture).
    let (bridge, mut parent) = UnixStream::pair().expect("bridge pair");
    let (shutdown_reader, _shutdown_writer) = shutdown_reader();
    let _runtime = super::bridge_runtime::BridgeRuntime::start(
        Arc::clone(&inner),
        bridge,
        shutdown_reader,
        tokio::runtime::Handle::current(),
    )
    .expect("bridge runtime");
    let ack = receive_frame::<ChildFrame>(&mut parent).expect("bootstrap ack");
    assert!(matches!(
        ack.frame,
        ChildFrame::BootstrapAck {
            protocol_version: CHILD_BRIDGE_PROTOCOL_VERSION,
            ..
        }
    ));

    let worker = spawn_worker(&inner);

    // Delivered to the old collector: the fixture receives the batch even
    // though its response is held open.
    assert_eq!(emit(&inner, protected("to-old")), EmitDisposition::Admitted);
    assert!(
        wait_for(|| old.batch_count() == 1).await,
        "the first record must reach the old collector"
    );

    // Two ordinary records queue behind the stalled in-flight request: a
    // non-empty in-flight set blocks all further dispatch, so they are still
    // resident when the generation advances.
    assert_eq!(
        emit(&inner, ordinary("queued-1")),
        EmitDisposition::Admitted
    );
    assert_eq!(
        emit(&inner, ordinary("queued-2")),
        EmitDisposition::Admitted
    );
    assert!(
        wait_for(|| super::tests_support::queued_sequences(&inner) == vec![2, 3]).await,
        "ordinary records queue behind the stalled request"
    );

    // Advance the generation over the wire: fresh boot id, new endpoint, and a
    // fresh capability descriptor delivered as SCM_RIGHTS. Both local ends of
    // the capability channel stay alive until the producer has converged. The
    // real parent lives in another process, so its descriptor numbers can
    // never collide with this process's; in this same-process harness,
    // releasing the numbers while the right is in flight hands them straight
    // to whichever concurrent test allocates next (see `rehome_above` in
    // activation_tests.rs for the same hazard from the other side).
    let (writer, inherited) = capability_channel();
    send_frame_until(
        &parent,
        &generation_ready(2, new.endpoint(), NEW_COLLECTOR_BOOT, inherited.as_raw_fd()),
        &[inherited.as_raw_fd()],
        Instant::now() + CHILD_BOOTSTRAP_READ_DEADLINE,
    )
    .expect("generation-ready frame");

    // The producer converges onto the new generation.
    assert!(
        wait_for(|| inner.snapshot().collector_state
            == ProducerCollectorState::Ready {
                collector_boot_id: NEW_COLLECTOR_BOOT.to_owned(),
                generation_number: 2,
            })
        .await,
        "the wire frame must replace the collector generation"
    );
    drop(writer);
    drop(inherited);

    // Fresh work dispatches to the new collector.
    assert_eq!(emit(&inner, protected("to-new")), EmitDisposition::Admitted);
    tokio::time::timeout(Duration::from_secs(2), async {
        assert!(
            wait_for(|| new
                .records()
                .iter()
                .any(|record| record.producer_sequence == 4))
            .await,
            "fresh work must reach the new collector"
        );
        assert!(drained(&inner).await, "all residency resolves");
    })
    .await
    .expect("reattach is prompt");

    settle().await;

    // The old collector never receives more than its single stalled batch, and
    // the abandoned survivors reach fallback rather than the new collector.
    assert_eq!(old.batch_count(), 1, "the old collector gets no retry");
    let mut reasons = fallback_reasons(&directory);
    reasons.sort();
    assert_eq!(
        reasons,
        vec![
            "delivery_unknown".to_owned(),
            "generation_changed".to_owned(),
            "generation_changed".to_owned(),
        ],
        "the cancelled in-flight request and the two queued records are routed, not silently dropped"
    );
    let delivered: Vec<u64> = new
        .records()
        .iter()
        .map(|record| record.producer_sequence)
        .collect();
    assert_eq!(
        delivered,
        vec![4],
        "only the post-swap record reaches the new collector"
    );

    let snapshot = inner.snapshot();
    assert_eq!(snapshot.fallback_routed, 3);
    assert!(
        !snapshot.delivery_fence_eligible,
        "an in-flight swap poisons the fence"
    );

    // A stale frame (generation <= current) is ignored: its capability is
    // consumed, the generation does not change, and no new work is dispatched.
    let (_stale_writer, stale_inherited) = capability_channel();
    send_frame_until(
        &parent,
        &generation_ready(
            2,
            new.endpoint(),
            NEW_COLLECTOR_BOOT,
            stale_inherited.as_raw_fd(),
        ),
        &[stale_inherited.as_raw_fd()],
        Instant::now() + CHILD_BOOTSTRAP_READ_DEADLINE,
    )
    .expect("stale generation-ready frame");

    assert_eq!(
        emit(&inner, protected("after-stale")),
        EmitDisposition::Admitted
    );
    assert!(
        wait_for(|| new
            .records()
            .iter()
            .any(|record| record.producer_sequence == 5))
        .await,
        "work continues on the unchanged generation after a stale frame"
    );
    assert!(drained(&inner).await);
    settle().await;
    assert_eq!(
        inner.snapshot().collector_state,
        ProducerCollectorState::Ready {
            collector_boot_id: NEW_COLLECTOR_BOOT.to_owned(),
            generation_number: 2,
        },
        "the stale frame left the generation untouched"
    );

    worker.abort();
}
