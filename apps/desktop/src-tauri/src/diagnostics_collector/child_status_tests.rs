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
    use super::*;
    use crate::diagnostics_collector::child_bridge::runtime::{
        ChildBridgeConnection, ChildProcessPresence, ChildProducerStatus,
        DesktopChildDiagnosticsState,
    };

    fn state(
        process: ChildProcessPresence,
        producer: ChildProducerStatus,
    ) -> DesktopChildDiagnosticsState {
        DesktopChildDiagnosticsState {
            process,
            bridge: ChildBridgeConnection::Connected,
            producer,
        }
    }

    #[test]
    fn native_state_mapping_is_closed_and_fail_safe() {
        assert_eq!(
            map_native_state(state(
                ChildProcessPresence::Missing,
                ChildProducerStatus::Unavailable,
            )),
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ChildMissing)
        );
        assert_eq!(
            map_native_state(state(
                ChildProcessPresence::Exited,
                ChildProducerStatus::Unavailable,
            )),
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ChildMissing)
        );
        assert_eq!(
            map_native_state(state(
                ChildProcessPresence::Running,
                ChildProducerStatus::Unavailable,
            )),
            PortableChildProducerStatus::Omitted(ChildStatusOmission::ProducerStatusUnavailable)
        );
        assert_eq!(
            map_native_state(state(
                ChildProcessPresence::Invalid,
                ChildProducerStatus::Unavailable,
            )),
            PortableChildProducerStatus::Omitted(ChildStatusOmission::SourceInvalid)
        );
        assert_eq!(
            map_native_state(state(
                ChildProcessPresence::Running,
                ChildProducerStatus::Invalid,
            )),
            PortableChildProducerStatus::Omitted(ChildStatusOmission::SourceInvalid)
        );
    }
}
