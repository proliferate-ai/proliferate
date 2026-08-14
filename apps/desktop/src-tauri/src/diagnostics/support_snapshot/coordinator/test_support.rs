use crate::diagnostics_collector::child_bridge::support_evidence::{
    EvidenceSource, EvidenceSourceRead, EvidenceSourceState, FiniteEvidenceCapture,
};

use super::super::schema::enums::{
    SupportChildOmissionReasonV1, SupportCollectorCompletenessV1, SupportCollectorStatusV1,
    SupportProducerStatusUnavailableV1,
};
use super::super::schema::model::evidence::SupportCollectorEvidenceV1;
use super::super::schema::model::health::{
    SupportChildProducerStatusV1, SupportOmittedProducerStatusV1, SupportProducerHealthV1,
    SupportTauriProducerHealthV1,
};
use super::capture::CapturedNativeSupportEvidence;

pub(super) fn empty_capture(captured_at: &str) -> CapturedNativeSupportEvidence {
    CapturedNativeSupportEvidence {
        collector: SupportCollectorEvidenceV1 {
            captured_at: captured_at.to_string(),
            desktop_health: None,
            coverage: super::capture::empty_coverage(
                SupportCollectorStatusV1::Unavailable,
                SupportCollectorCompletenessV1::Unknown,
            ),
            export_manifest: None,
            export_health: None,
            gaps: Vec::new(),
        },
        collector_records: Vec::new(),
        producer_health: SupportProducerHealthV1 {
            renderer: SupportOmittedProducerStatusV1::default(),
            tauri: SupportTauriProducerHealthV1::Omitted {
                reason: SupportProducerStatusUnavailableV1::ProducerStatusUnavailable,
            },
            anyharness: omitted_child(captured_at),
            desktop_worker: omitted_child(captured_at),
        },
        files: FiniteEvidenceCapture {
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
            .map(empty_source)
            .collect(),
        },
    }
}

fn omitted_child(captured_at: &str) -> SupportChildProducerStatusV1 {
    SupportChildProducerStatusV1::Omitted {
        captured_at: captured_at.to_string(),
        reason: SupportChildOmissionReasonV1::ProducerStatusUnavailable,
    }
}

fn empty_source(source: EvidenceSource) -> EvidenceSourceRead {
    EvidenceSourceRead {
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
