use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset};
use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ExportManifestV1, ExportRequestV1, ExportStreamFrameV1, GapV1,
    HealthResponseV1, RedactionClassificationV1, SchemaVersionV1,
};
use proliferate_diagnostics_protocol::v1::validation::validate_export_frame;

use super::{SupportExportError, ValidatedSupportExport};

#[derive(Clone, Copy, PartialEq, Eq)]
enum StreamPhase {
    Manifest,
    Records,
    Gaps,
    Health,
    End,
}

pub(super) struct SupportExportAccumulator {
    request: ExportRequestV1,
    from: DateTime<FixedOffset>,
    to: DateTime<FixedOffset>,
    phase: StreamPhase,
    manifest: Option<ExportManifestV1>,
    records: Vec<CollectorAcceptedRecordV1>,
    record_bytes: u64,
    gaps: Vec<GapV1>,
    health: Option<HealthResponseV1>,
    end: Option<(u32, u64)>,
}

impl SupportExportAccumulator {
    pub(super) fn new(request: ExportRequestV1) -> Result<Self, SupportExportError> {
        let from = request
            .filters
            .source_time_from
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .ok_or(SupportExportError::InvalidRequest)?;
        let to = request
            .filters
            .source_time_to
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .ok_or(SupportExportError::InvalidRequest)?;
        Ok(Self {
            request,
            from,
            to,
            phase: StreamPhase::Manifest,
            manifest: None,
            records: Vec::new(),
            record_bytes: 0,
            gaps: Vec::new(),
            health: None,
            end: None,
        })
    }

    pub(super) fn push(&mut self, frame: ExportStreamFrameV1) -> Result<(), SupportExportError> {
        validate_export_frame(&frame).map_err(|_| SupportExportError::InvalidStream)?;
        match frame {
            ExportStreamFrameV1::Manifest { manifest } if self.phase == StreamPhase::Manifest => {
                if manifest.schema_version != CURRENT_SCHEMA_VERSION
                    || manifest.filters != self.request.filters
                    || manifest.redaction != RedactionClassificationV1::SupportExport
                    || !manifest.includes_health
                    || manifest.record_count > self.request.record_limit
                    || manifest.byte_count > self.request.byte_limit
                    || !is_snapshot_id(&manifest.snapshot_id)
                {
                    return Err(SupportExportError::InvalidStream);
                }
                self.manifest = Some(manifest);
                self.phase = StreamPhase::Records;
            }
            ExportStreamFrameV1::Record { record } if self.phase == StreamPhase::Records => {
                let record_bytes = serde_json::to_vec(&record)
                    .map_err(|_| SupportExportError::InvalidStream)?
                    .len() as u64;
                let next_bytes = self
                    .record_bytes
                    .checked_add(record_bytes)
                    .ok_or(SupportExportError::InvalidStream)?;
                if self.records.len() >= self.request.record_limit as usize
                    || next_bytes > self.request.byte_limit
                    || !self.record_matches(&record)
                    || self.records.last().is_some_and(|previous| {
                        record.accepted_order <= previous.accepted_order
                            || record.retention_cursor <= previous.retention_cursor
                    })
                {
                    return Err(SupportExportError::InvalidStream);
                }
                self.record_bytes = next_bytes;
                self.records.push(record);
            }
            ExportStreamFrameV1::Gap { gap }
                if matches!(self.phase, StreamPhase::Records | StreamPhase::Gaps) =>
            {
                let expected = self
                    .manifest
                    .as_ref()
                    .and_then(|manifest| manifest.gaps.get(self.gaps.len()));
                if expected != Some(&gap) {
                    return Err(SupportExportError::InvalidStream);
                }
                self.gaps.push(gap);
                self.phase = StreamPhase::Gaps;
            }
            ExportStreamFrameV1::Health { health }
                if matches!(self.phase, StreamPhase::Records | StreamPhase::Gaps) =>
            {
                self.health = Some(health);
                self.phase = StreamPhase::Health;
            }
            ExportStreamFrameV1::End { records, bytes } if self.phase == StreamPhase::Health => {
                self.end = Some((records, bytes));
                self.phase = StreamPhase::End;
            }
            _ => return Err(SupportExportError::InvalidStream),
        }
        Ok(())
    }

    pub(super) fn finish(self) -> Result<ValidatedSupportExport, SupportExportError> {
        if self.phase != StreamPhase::End {
            return Err(SupportExportError::InvalidStream);
        }
        let manifest = self.manifest.ok_or(SupportExportError::InvalidStream)?;
        let health = self.health.ok_or(SupportExportError::InvalidStream)?;
        let (end_records, end_bytes) = self.end.ok_or(SupportExportError::InvalidStream)?;
        let record_count =
            u32::try_from(self.records.len()).map_err(|_| SupportExportError::InvalidStream)?;
        if manifest.record_count != record_count
            || end_records != record_count
            || manifest.byte_count != self.record_bytes
            || end_bytes != self.record_bytes
            || manifest.cursor_start != self.records.first().map(|record| record.retention_cursor)
            || manifest.cursor_end != self.records.last().map(|record| record.retention_cursor)
            || manifest.gaps != self.gaps
            || !versions_match(&manifest, &self.records)
            || !cursor_fence_contains(&health, &self.records)
        {
            return Err(SupportExportError::InvalidStream);
        }
        Ok(ValidatedSupportExport {
            manifest,
            records: self.records,
            gaps: self.gaps,
            health,
        })
    }

    fn record_matches(&self, record: &CollectorAcceptedRecordV1) -> bool {
        let Ok(timestamp) = DateTime::parse_from_rfc3339(&record.record.source_timestamp) else {
            return false;
        };
        self.request
            .filters
            .components
            .contains(&record.record.component)
            && self
                .request
                .filters
                .record_classes
                .contains(&record.record.record_class)
            && timestamp >= self.from
            && timestamp <= self.to
    }
}

fn is_snapshot_id(value: &str) -> bool {
    value
        .strip_prefix("snapshot-")
        .and_then(|value| {
            uuid::Uuid::parse_str(value)
                .ok()
                .map(|parsed| (parsed, value))
        })
        .is_some_and(|(parsed, value)| parsed.to_string() == value)
}

fn versions_match(manifest: &ExportManifestV1, records: &[CollectorAcceptedRecordV1]) -> bool {
    let mut actual = BTreeMap::<SchemaVersionV1, u64>::new();
    for record in records {
        *actual.entry(record.record.schema_version).or_default() += 1;
    }
    let mut declared = BTreeMap::new();
    for entry in &manifest.versions_present {
        if entry.records == 0 || declared.insert(entry.version, entry.records).is_some() {
            return false;
        }
    }
    actual == declared
}

fn cursor_fence_contains(health: &HealthResponseV1, records: &[CollectorAcceptedRecordV1]) -> bool {
    if health
        .oldest_cursor
        .zip(health.newest_cursor)
        .is_some_and(|(oldest, newest)| oldest > newest)
    {
        return false;
    }
    records.iter().all(|record| {
        !health
            .oldest_cursor
            .is_some_and(|oldest| record.retention_cursor < oldest)
            && !health
                .newest_cursor
                .is_some_and(|newest| record.retention_cursor > newest)
    })
}
