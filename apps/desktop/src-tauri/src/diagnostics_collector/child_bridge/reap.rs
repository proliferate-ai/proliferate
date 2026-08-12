//! Typed child-reap proof and ordered producer-death qualification.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChildReapKind {
    Natural,
    Orderly,
    Forced,
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
mod supported {
    use std::os::unix::process::ExitStatusExt;
    use std::process::ExitStatus;

    use proliferate_diagnostics_client::bridge::wire::WireComponent;
    use tokio::time::Instant;

    use super::ChildReapKind;
    use crate::diagnostics_collector::child_bridge::runtime::ChildDiagnosticsBridge;
    use crate::diagnostics_collector::supervisor::{TerminalControlOutcome, TerminalProducerSlot};

    /// Constructible only from the result of the retained identity-stable
    /// `Child`. Signal exits (including panic-abort) and forced termination
    /// remain verified reap facts, but are explicitly ineligible to claim
    /// collector-finalized producer death.
    pub(crate) struct VerifiedChildReap {
        _status: ExitStatus,
        eligible_for_producer_dead: bool,
    }

    impl VerifiedChildReap {
        pub(crate) fn new(status: ExitStatus, kind: ChildReapKind) -> Self {
            let eligible_for_producer_dead =
                kind != ChildReapKind::Forced && status.signal().is_none();
            Self {
                _status: status,
                eligible_for_producer_dead,
            }
        }

        #[cfg(test)]
        fn eligible_for_producer_dead(&self) -> bool {
            self.eligible_for_producer_dead
        }

        fn qualifies_fence(&self, has_qualified_fence: bool) -> bool {
            self.eligible_for_producer_dead && has_qualified_fence
        }
    }

    impl ChildDiagnosticsBridge {
        pub(crate) async fn finish_verified_reap(
            &self,
            reap: VerifiedChildReap,
            deadline: Instant,
        ) -> TerminalControlOutcome {
            self.finish_reader_after_reap(deadline).await;
            let fence = self
                .qualified_result()
                .and_then(|result| result.delivery_fence);
            if !reap.qualifies_fence(fence.is_some()) {
                return TerminalControlOutcome::Unavailable;
            }
            let fence = fence.expect("qualified reap checked fence presence");
            let slot = match self.component() {
                WireComponent::Anyharness => TerminalProducerSlot::AnyHarness,
                WireComponent::DesktopWorker => TerminalProducerSlot::DesktopWorker,
            };
            let Some(supervisor) = self.supervisor() else {
                return TerminalControlOutcome::Unavailable;
            };
            supervisor
                .send_producer_dead_if_current(
                    slot,
                    &fence.collector_boot_id,
                    fence.generation,
                    &fence.producer_boot_id,
                )
                .await
        }
    }

    pub(crate) use VerifiedChildReap as ReapProof;

    #[cfg(test)]
    mod tests {
        use std::os::unix::process::ExitStatusExt;
        use std::process::ExitStatus;

        use super::{ChildReapKind, VerifiedChildReap};

        #[test]
        fn qualified_fence_attempt_count_is_one_for_natural_or_orderly_and_zero_for_forced() {
            let success = || ExitStatus::from_raw(0);
            let attempt_count =
                |kind| usize::from(VerifiedChildReap::new(success(), kind).qualifies_fence(true));
            assert_eq!(attempt_count(ChildReapKind::Natural), 1);
            assert_eq!(attempt_count(ChildReapKind::Orderly), 1);
            assert_eq!(attempt_count(ChildReapKind::Forced), 0);
            assert!(!VerifiedChildReap::new(
                ExitStatus::from_raw(libc::SIGABRT),
                ChildReapKind::Natural,
            )
            .eligible_for_producer_dead());
        }
    }
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(crate) use supported::ReapProof as VerifiedChildReap;
