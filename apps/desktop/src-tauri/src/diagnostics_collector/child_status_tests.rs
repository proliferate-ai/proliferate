use super::*;

#[test]
fn unsupported_capture_is_fixed_and_contains_no_target_or_snapshot() {
    let capture = unsupported_capture();
    assert!(matches!(
        capture.anyharness.status,
        PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
    ));
    assert_eq!(capture.desktop_worker.target_id, None);
    assert!(matches!(
        capture.desktop_worker.producer.status,
        PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
    ));
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
mod supported {
    use std::sync::Arc;

    use proliferate_diagnostics_client::{ProducerCollectorState, ProducerStatusSnapshot};
    use proliferate_diagnostics_protocol::v1::types::ComponentV1;
    use tokio::sync::Barrier;

    use super::*;
    use crate::{
        commands::cloud_worker::state::DesktopWorkerDiagnosticsState,
        diagnostics_collector::child_bridge::runtime::{
            ChildBridgeConnection, ChildProcessPresence, ChildProducerStatus,
            DesktopChildDiagnosticsState,
        },
    };

    fn snapshot() -> ProducerStatusSnapshot {
        ProducerStatusSnapshot {
            component: ComponentV1::Anyharness,
            producer_boot_id: "producer-boot".into(),
            last_assigned_sequence: Some(1),
            next_sequence: Some(2),
            collector_state: ProducerCollectorState::Ready {
                collector_boot_id: "collector-boot".into(),
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

    fn state(
        process: ChildProcessPresence,
        bridge: ChildBridgeConnection,
        producer: ChildProducerStatus,
    ) -> DesktopChildDiagnosticsState {
        DesktopChildDiagnosticsState {
            process,
            bridge,
            producer,
        }
    }

    fn expected(
        process: ChildProcessPresence,
        bridge: ChildBridgeConnection,
        producer: &ChildProducerStatus,
    ) -> PortableChildProducerStatus {
        if process == ChildProcessPresence::Invalid
            || matches!(producer, ChildProducerStatus::Invalid)
        {
            return PortableChildProducerStatus::Omitted(ChildStatusOmission::SourceInvalid);
        }
        if matches!(
            process,
            ChildProcessPresence::Missing | ChildProcessPresence::Exited
        ) {
            return PortableChildProducerStatus::Omitted(ChildStatusOmission::ChildMissing);
        }
        match (bridge, producer) {
            (ChildBridgeConnection::Connected, ChildProducerStatus::Available(value)) => {
                PortableChildProducerStatus::Available(value.clone())
            }
            _ => {
                PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
            }
        }
    }

    #[test]
    fn native_state_mapping_is_exhaustive_and_bridge_fail_safe() {
        let processes = [
            ChildProcessPresence::Missing,
            ChildProcessPresence::Running,
            ChildProcessPresence::Exited,
            ChildProcessPresence::Invalid,
        ];
        let bridges = [
            ChildBridgeConnection::NotActivated,
            ChildBridgeConnection::Connected,
            ChildBridgeConnection::Lost,
        ];
        for process in processes {
            for bridge in bridges {
                for producer in [
                    ChildProducerStatus::Available(snapshot()),
                    ChildProducerStatus::Unavailable,
                    ChildProducerStatus::Invalid,
                ] {
                    assert_eq!(
                        map_native_state(state(process, bridge, producer.clone())),
                        expected(process, bridge, &producer),
                        "process={process:?}, bridge={bridge:?}, producer={producer:?}"
                    );
                }
            }
        }
        assert!(matches!(
            map_native_state(state(
                ChildProcessPresence::Running,
                ChildBridgeConnection::Lost,
                ChildProducerStatus::Available(snapshot()),
            )),
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
        ));
        assert!(matches!(
            map_native_state(state(
                ChildProcessPresence::Running,
                ChildBridgeConnection::NotActivated,
                ChildProducerStatus::Available(snapshot()),
            )),
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
        ));
    }

    #[tokio::test]
    async fn injectable_samplers_are_joined_and_receive_one_absolute_deadline() {
        let barrier = Arc::new(Barrier::new(2));
        let deadline = tokio::time::Instant::now() + CHILD_STATUS_RESPONSE_DEADLINE;
        let anyharness_barrier = Arc::clone(&barrier);
        let worker_barrier = Arc::clone(&barrier);
        let capture = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            capture_native_child_statuses_with(
                deadline,
                move |received| async move {
                    assert_eq!(received, deadline);
                    anyharness_barrier.wait().await;
                    Some(state(
                        ChildProcessPresence::Running,
                        ChildBridgeConnection::Connected,
                        ChildProducerStatus::Available(snapshot()),
                    ))
                },
                move |received| async move {
                    assert_eq!(received, deadline);
                    worker_barrier.wait().await;
                    DesktopWorkerDiagnosticsState {
                        target_id: Some("target".into()),
                        child: state(
                            ChildProcessPresence::Running,
                            ChildBridgeConnection::Connected,
                            ChildProducerStatus::Available(snapshot()),
                        ),
                    }
                },
            ),
        )
        .await
        .expect("joined samplers must both start");
        assert!(matches!(
            capture.anyharness.status,
            PortableChildProducerStatus::Available(_)
        ));
        assert_eq!(capture.desktop_worker.target_id.as_deref(), Some("target"));
    }

    #[tokio::test]
    async fn joined_timeouts_consume_one_shared_hundred_millisecond_window() {
        let barrier = Arc::new(Barrier::new(2));
        let started = tokio::time::Instant::now();
        let deadline = started + CHILD_STATUS_RESPONSE_DEADLINE;
        let anyharness_barrier = Arc::clone(&barrier);
        let worker_barrier = Arc::clone(&barrier);
        let capture = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            capture_native_child_statuses_with(
                deadline,
                move |received| async move {
                    assert_eq!(received, deadline);
                    anyharness_barrier.wait().await;
                    assert!(
                        tokio::time::timeout_at(received, std::future::pending::<()>())
                            .await
                            .is_err()
                    );
                    None
                },
                move |received| async move {
                    assert_eq!(received, deadline);
                    worker_barrier.wait().await;
                    assert!(
                        tokio::time::timeout_at(received, std::future::pending::<()>())
                            .await
                            .is_err()
                    );
                    DesktopWorkerDiagnosticsState {
                        target_id: None,
                        child: state(
                            ChildProcessPresence::Invalid,
                            ChildBridgeConnection::Lost,
                            ChildProducerStatus::Invalid,
                        ),
                    }
                },
            ),
        )
        .await
        .expect("joined samplers share one bounded real-time wait");
        let elapsed = tokio::time::Instant::now() - started;
        assert_eq!(deadline - started, CHILD_STATUS_RESPONSE_DEADLINE);
        assert!(elapsed >= CHILD_STATUS_RESPONSE_DEADLINE);
        assert!(elapsed < std::time::Duration::from_secs(1));
        assert!(matches!(
            capture.anyharness.status,
            PortableChildProducerStatus::Omitted(ChildStatusOmission::SourceInvalid)
        ));
        assert!(matches!(
            capture.desktop_worker.producer.status,
            PortableChildProducerStatus::Omitted(ChildStatusOmission::SourceInvalid)
        ));
    }
}
