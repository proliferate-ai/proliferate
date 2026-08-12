//! Closed inventory and portable result types for consented support file evidence.
//!
//! Callers supply only native-owned roots and bounded, evidence-derived Worker
//! target IDs. The implementation enumerates fixed leaves; there is no glob,
//! walk, arbitrary path, writer, repair, replay, or cleanup surface here.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use proliferate_diagnostics_client::FallbackRecordV1;
use proliferate_diagnostics_protocol::v1::types::ProducerRecordV1;

pub(crate) const SOURCE_LINE_BYTES: usize = 262_144;
pub(crate) const COMPONENT_FILES_READ_BYTES: u64 = 2_097_152;
pub(crate) const ALL_FILES_READ_BYTES: u64 = 10_485_760;
pub(crate) const DESKTOP_ACTIVE_READ_BYTES: u64 = 1_048_576;
pub(crate) const MAX_WORKER_LEGACY_TARGETS: usize = 10;
pub(crate) const MAX_RETAINED_LINES_PER_SOURCE: usize = 10_000;

pub(crate) const FALLBACK_SEGMENTS: [(&str, u8); 4] = [
    ("{leaf}.3", 3),
    ("{leaf}.2", 2),
    ("{leaf}.1", 1),
    ("{leaf}", 0),
];
pub(crate) const LEGACY_SEGMENTS: [(&str, u8); 6] = [
    ("{leaf}.5", 5),
    ("{leaf}.4", 4),
    ("{leaf}.3", 3),
    ("{leaf}.2", 2),
    ("{leaf}.1", 1),
    ("{leaf}", 0),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum EvidenceSource {
    DesktopNativeFallback,
    AnyharnessFallback,
    DesktopWorkerFallback,
    RendererLegacy,
    AnyharnessLegacy,
    WorkerLegacyV2,
    WorkerLegacyV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EvidenceSourceState {
    Included,
    Missing,
    Unreadable,
    UnsafeMetadata,
    Invalid,
    Omitted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EvidenceSegmentState {
    Available,
    Missing,
    Unreadable,
    UnsafeMetadata,
    SourceCap,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EvidenceParser {
    DesktopMixed,
    AnyharnessWrapped,
    DesktopWorkerWrapped,
    Legacy,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum EvidenceValue {
    DesktopRecord(ProducerRecordV1),
    DesktopOpaque {
        value: String,
        invalid_utf8_bytes: u64,
    },
    Wrapped(FallbackRecordV1),
    Legacy {
        value: String,
        invalid_utf8_bytes: u64,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EvidenceLine {
    pub(crate) segment: u8,
    pub(crate) line: u64,
    /// Exact complete-line source bytes retained by the bounded reader,
    /// including the consumed newline delimiter.
    pub(crate) included_bytes: u64,
    pub(crate) value: EvidenceValue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EvidenceSegmentRead {
    pub(crate) segment: u8,
    pub(crate) state: EvidenceSegmentState,
    pub(crate) snapshotted_bytes: u64,
    pub(crate) read_bytes: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EvidenceSourceRead {
    pub(crate) source: EvidenceSource,
    pub(crate) state: EvidenceSourceState,
    pub(crate) read_bytes: u64,
    pub(crate) included_bytes: u64,
    pub(crate) invalid_lines: u64,
    pub(crate) invalid_utf8_bytes: u64,
    pub(crate) incomplete_leading_bytes: u64,
    pub(crate) incomplete_final_bytes: u64,
    pub(crate) oversized_lines: u64,
    pub(crate) oversized_line_bytes: u64,
    pub(crate) omitted_by_cap: u64,
    pub(crate) segments: Vec<EvidenceSegmentRead>,
    pub(crate) lines: Vec<EvidenceLine>,
}

impl EvidenceSourceRead {
    fn omitted(source: EvidenceSource) -> Self {
        Self {
            source,
            state: EvidenceSourceState::Omitted,
            read_bytes: 0,
            included_bytes: 0,
            invalid_lines: 0,
            invalid_utf8_bytes: 0,
            incomplete_leading_bytes: 0,
            incomplete_final_bytes: 0,
            oversized_lines: 0,
            oversized_line_bytes: 0,
            omitted_by_cap: 0,
            segments: Vec::new(),
            lines: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FiniteEvidenceCapture {
    pub(crate) total_read_bytes: u64,
    pub(crate) sources: Vec<EvidenceSourceRead>,
}

#[derive(Clone, Debug)]
pub(crate) struct FiniteEvidenceRoots {
    pub(crate) desktop_logs: PathBuf,
    pub(crate) anyharness_runtime_home: Option<PathBuf>,
    pub(crate) app_dir: PathBuf,
    pub(crate) worker_target_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EvidenceCaptureInterrupted {
    Cancelled,
    Deadline,
}

pub(crate) struct EvidenceCaptureGuard {
    cancelled: Arc<AtomicBool>,
    deadline_expired: Arc<AtomicBool>,
}

impl EvidenceCaptureGuard {
    pub(crate) fn new(cancelled: Arc<AtomicBool>, deadline_expired: Arc<AtomicBool>) -> Self {
        Self {
            cancelled,
            deadline_expired,
        }
    }

    pub(crate) fn check(&self) -> Result<(), EvidenceCaptureInterrupted> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(EvidenceCaptureInterrupted::Cancelled)
        } else if self.deadline_expired.load(Ordering::Acquire) {
            Err(EvidenceCaptureInterrupted::Deadline)
        } else {
            Ok(())
        }
    }
}

impl FiniteEvidenceRoots {
    pub(crate) fn new(
        desktop_logs: &Path,
        anyharness_runtime_home: Option<&Path>,
        app_dir: &Path,
        worker_target_ids: &[String],
    ) -> Self {
        Self {
            desktop_logs: desktop_logs.to_path_buf(),
            anyharness_runtime_home: anyharness_runtime_home.map(Path::to_path_buf),
            app_dir: app_dir.to_path_buf(),
            worker_target_ids: worker_target_ids.to_vec(),
        }
    }
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
#[path = "support_evidence_unix.rs"]
mod platform;

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
pub(crate) use platform::{collect_finite_evidence, collect_finite_evidence_guarded};

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
pub(crate) fn collect_finite_evidence(_roots: &FiniteEvidenceRoots) -> FiniteEvidenceCapture {
    FiniteEvidenceCapture {
        total_read_bytes: 0,
        sources: [
            EvidenceSource::DesktopNativeFallback,
            EvidenceSource::AnyharnessFallback,
            EvidenceSource::DesktopWorkerFallback,
            EvidenceSource::RendererLegacy,
            EvidenceSource::AnyharnessLegacy,
            EvidenceSource::WorkerLegacyV2,
            EvidenceSource::WorkerLegacyV1,
        ]
        .into_iter()
        .map(EvidenceSourceRead::omitted)
        .collect(),
    }
}

#[cfg(not(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
)))]
pub(crate) fn collect_finite_evidence_guarded(
    roots: &FiniteEvidenceRoots,
    guard: &EvidenceCaptureGuard,
) -> Result<FiniteEvidenceCapture, EvidenceCaptureInterrupted> {
    guard.check()?;
    Ok(collect_finite_evidence(roots))
}

#[cfg(test)]
mod guard_tests {
    use super::*;

    #[test]
    fn capture_guard_fails_closed_for_cancel_and_deadline() {
        let cancelled = Arc::new(AtomicBool::new(true));
        let guard = EvidenceCaptureGuard::new(cancelled, Arc::new(AtomicBool::new(false)));
        assert_eq!(guard.check(), Err(EvidenceCaptureInterrupted::Cancelled));

        let guard = EvidenceCaptureGuard::new(
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(true)),
        );
        assert_eq!(guard.check(), Err(EvidenceCaptureInterrupted::Deadline));
    }
}

#[cfg(test)]
#[path = "support_evidence_tests.rs"]
mod tests;
