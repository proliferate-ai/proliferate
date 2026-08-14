use crate::diagnostics_collector::child_bridge::support_evidence::{
    EvidenceSource, EvidenceSourceRead, EvidenceSourceState, EvidenceValue,
};

use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportTruncationReasonV1,
};
use super::super::schema::model::common::{SupportOmissionV1, SupportTruncationV1};
use super::super::scrub::SupportScrubAccounting;
use super::finish::FinishError;

pub(super) fn record_file_residuals(
    source: &EvidenceSourceRead,
    accounting: &mut SupportScrubAccounting,
) -> Result<(), FinishError> {
    let retained_bytes = source.lines.iter().try_fold(0_u64, |total, line| {
        total
            .checked_add(line.included_bytes)
            .ok_or(FinishError::Manifest)
    })?;
    if retained_bytes != source.included_bytes || source.included_bytes > source.read_bytes {
        return Err(FinishError::Manifest);
    }
    let evidence_source = evidence_source(source.source);
    if source.invalid_lines > 0 && source.state != EvidenceSourceState::Invalid {
        accounting.omissions.push(SupportOmissionV1 {
            source: evidence_source,
            reason: SupportOmissionReasonV1::SourceInvalid,
            count: source.invalid_lines,
            known_bytes: None,
        });
    }
    if source.omitted_by_cap > 0 {
        accounting.omissions.push(SupportOmissionV1 {
            source: evidence_source,
            reason: SupportOmissionReasonV1::SourceCap,
            count: source.omitted_by_cap,
            known_bytes: None,
        });
        accounting.truncations.push(SupportTruncationV1 {
            source: evidence_source,
            reason: SupportTruncationReasonV1::ComponentBytes,
            count: source.omitted_by_cap,
            omitted_bytes: None,
        });
    }
    let tail_bytes = source
        .incomplete_leading_bytes
        .checked_add(source.incomplete_final_bytes)
        .ok_or(FinishError::Manifest)?;
    let tail_count = u64::from(source.incomplete_leading_bytes > 0)
        + u64::from(source.incomplete_final_bytes > 0);
    if tail_count > 0 {
        accounting.truncations.push(SupportTruncationV1 {
            source: evidence_source,
            reason: SupportTruncationReasonV1::SourceTail,
            count: tail_count,
            omitted_bytes: Some(tail_bytes),
        });
    }
    let (invalid_utf8_lines, retained_invalid_utf8_bytes) =
        source
            .lines
            .iter()
            .try_fold((0_u64, 0_u64), |total, line| {
                let bytes = match &line.value {
                    EvidenceValue::DesktopOpaque {
                        invalid_utf8_bytes, ..
                    }
                    | EvidenceValue::Legacy {
                        invalid_utf8_bytes, ..
                    } => *invalid_utf8_bytes,
                    _ => 0,
                };
                Ok::<_, FinishError>((
                    total.0 + u64::from(bytes > 0),
                    total.1.checked_add(bytes).ok_or(FinishError::Manifest)?,
                ))
            })?;
    if retained_invalid_utf8_bytes != source.invalid_utf8_bytes {
        return Err(FinishError::Manifest);
    }
    if invalid_utf8_lines > 0 {
        accounting.truncations.push(SupportTruncationV1 {
            source: evidence_source,
            reason: SupportTruncationReasonV1::FieldBytes,
            count: invalid_utf8_lines,
            omitted_bytes: Some(source.invalid_utf8_bytes),
        });
    }
    if source.oversized_line_bytes > 0 {
        if source.oversized_lines == 0 {
            return Err(FinishError::Manifest);
        }
        accounting.truncations.push(SupportTruncationV1 {
            source: evidence_source,
            reason: SupportTruncationReasonV1::FieldBytes,
            count: source.oversized_lines,
            omitted_bytes: Some(source.oversized_line_bytes),
        });
    }
    Ok(())
}

fn evidence_source(source: EvidenceSource) -> SupportEvidenceSourceV1 {
    match source {
        EvidenceSource::DesktopNativeFallback => SupportEvidenceSourceV1::Tauri,
        EvidenceSource::RendererLegacy => SupportEvidenceSourceV1::Renderer,
        EvidenceSource::AnyharnessFallback | EvidenceSource::AnyharnessLegacy => {
            SupportEvidenceSourceV1::Anyharness
        }
        EvidenceSource::DesktopWorkerFallback
        | EvidenceSource::WorkerLegacyV2
        | EvidenceSource::WorkerLegacyV1 => SupportEvidenceSourceV1::DesktopWorker,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics_collector::child_bridge::support_evidence::{
        EvidenceLine, EvidenceValue,
    };

    #[test]
    fn exact_line_bytes_and_file_residuals_reach_the_manifest_accounting() {
        let source = EvidenceSourceRead {
            source: EvidenceSource::RendererLegacy,
            state: EvidenceSourceState::Included,
            read_bytes: 20,
            included_bytes: 5,
            invalid_lines: 2,
            invalid_utf8_bytes: 1,
            incomplete_leading_bytes: 3,
            incomplete_final_bytes: 2,
            oversized_lines: 1,
            oversized_line_bytes: 9,
            omitted_by_cap: 1,
            segments: Vec::new(),
            lines: vec![EvidenceLine {
                segment: 0,
                line: 1,
                included_bytes: 5,
                value: EvidenceValue::Legacy {
                    value: "safe".to_string(),
                    invalid_utf8_bytes: 1,
                },
            }],
        };
        let mut accounting = SupportScrubAccounting::default();
        record_file_residuals(&source, &mut accounting).expect("accounting");
        assert!(accounting
            .omissions
            .iter()
            .all(|entry| { entry.source == SupportEvidenceSourceV1::Renderer }));
        assert!(accounting
            .omissions
            .iter()
            .any(|entry| entry.reason == SupportOmissionReasonV1::SourceInvalid));
        assert!(accounting
            .truncations
            .iter()
            .any(|entry| entry.reason == SupportTruncationReasonV1::SourceTail));
        assert!(accounting
            .truncations
            .iter()
            .any(|entry| entry.reason == SupportTruncationReasonV1::FieldBytes));
    }

    #[test]
    fn inconsistent_source_byte_accounting_fails_closed() {
        let source = EvidenceSourceRead {
            source: EvidenceSource::AnyharnessLegacy,
            state: EvidenceSourceState::Included,
            read_bytes: 2,
            included_bytes: 2,
            invalid_lines: 0,
            invalid_utf8_bytes: 0,
            incomplete_leading_bytes: 0,
            incomplete_final_bytes: 0,
            oversized_lines: 0,
            oversized_line_bytes: 0,
            omitted_by_cap: 0,
            segments: Vec::new(),
            lines: Vec::new(),
        };
        assert_eq!(
            record_file_residuals(&source, &mut SupportScrubAccounting::default()),
            Err(FinishError::Manifest)
        );
    }
}
