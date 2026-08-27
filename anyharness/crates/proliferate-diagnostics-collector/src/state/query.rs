use std::collections::BTreeMap;

use chrono::{DateTime, SecondsFormat, Utc};
use proliferate_diagnostics_protocol::v1::limits::{
    CURRENT_SCHEMA_VERSION, MAX_TAIL_FRAME_RECORDS,
};
use proliferate_diagnostics_protocol::v1::types::{
    CollectorAcceptedRecordV1, ExportManifestV1, ExportPurposeV1, ExportRequestV1, GapReasonV1,
    GapV1, HealthResponseV1, RecordsFilterV1, RecordsPageV1, RecordsQueryV1,
    RedactionClassificationV1, SchemaVersionV1, VersionCountV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_export_manifest, validate_export_request, validate_records_page,
    validate_records_query,
};

use super::{CollectorCore, CoreError, StoredRecord};

pub(crate) struct TailPage {
    pub gap: Option<GapV1>,
    pub records: Vec<CollectorAcceptedRecordV1>,
    pub caught_up: bool,
}

pub(crate) struct ExportSnapshot {
    pub manifest: ExportManifestV1,
    pub records: Vec<StoredRecord>,
    pub gaps: Vec<GapV1>,
    pub health: Option<HealthResponseV1>,
    pub record_bytes: u64,
}

impl CollectorCore {
    pub(crate) fn query(&self, query: &RecordsQueryV1) -> Result<RecordsPageV1, RejectionReason> {
        validate_records_query(query).map_err(RejectionReason::Contract)?;
        let inner = self.lock();
        let after = query.after_cursor.unwrap_or(0);
        let mut page_records = Vec::new();
        let mut page_bytes = 0_usize;
        let mut page_full = false;
        let mut versions = BTreeMap::<SchemaVersionV1, u64>::new();
        for stored in &inner.records {
            let accepted = stored.decode().map_err(|_| RejectionReason::Core)?;
            *versions.entry(stored.version).or_default() += 1;
            if record_matches(&accepted, &query.filters)
                && stored.cursor > after
                    && page_records.len() < usize::from(query.limit)
                    && !page_full
                {
                    if page_records.is_empty()
                        || page_bytes.saturating_add(stored.encoded.len())
                            <= self.limits.query_page_bytes
                    {
                        page_bytes = page_bytes.saturating_add(stored.encoded.len());
                        page_records.push(accepted);
                    } else {
                        page_full = true;
                    }
                }
        }
        let mut gaps = Vec::new();
        if let Some(gap) = eviction_gap(
            after,
            inner.evicted_through_cursor,
            inner.records.front().map(|record| record.cursor),
        ) {
            gaps.push(gap);
        }
        for gap in &inner.gaps {
            if gaps.len() == proliferate_diagnostics_protocol::v1::limits::MAX_CARDINALITY_ENTRIES {
                break;
            }
            gaps.push(gap.clone());
        }
        let page = RecordsPageV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            next_cursor: page_records.last().map(|record| record.retention_cursor),
            records: page_records,
            gaps,
            versions_present: versions
                .into_iter()
                .map(|(version, records)| VersionCountV1 { version, records })
                .collect(),
        };
        validate_records_page(&page).map_err(RejectionReason::Contract)?;
        Ok(page)
    }

    pub(crate) fn tail_page(&self, after_cursor: u64) -> Result<TailPage, CoreError> {
        let inner = self.lock();
        let mut accepted = Vec::new();
        let mut frame_bytes = 0_usize;
        for stored in inner
            .records
            .iter()
            .filter(|record| record.cursor > after_cursor)
        {
            if !accepted.is_empty()
                && frame_bytes.saturating_add(stored.encoded.len()) > self.limits.tail_frame_bytes
            {
                break;
            }
            frame_bytes = frame_bytes.saturating_add(stored.encoded.len());
            accepted.push(stored.decode()?);
            if accepted.len() == MAX_TAIL_FRAME_RECORDS {
                break;
            }
        }
        let gap = eviction_gap(
            after_cursor,
            inner.evicted_through_cursor,
            inner.records.front().map(|record| record.cursor),
        );
        let effective_cursor = accepted
            .last()
            .map(|record| record.retention_cursor)
            .or_else(|| gap.as_ref().and_then(|gap| gap.to_cursor))
            .unwrap_or(after_cursor);
        let newest_available = inner
            .records
            .back()
            .map(|record| record.cursor)
            .or(inner.evicted_through_cursor);
        Ok(TailPage {
            gap,
            records: accepted,
            caught_up: newest_available.is_none_or(|newest| effective_cursor >= newest),
        })
    }

    pub(crate) fn export_snapshot(
        &self,
        request: &ExportRequestV1,
    ) -> Result<ExportSnapshot, RejectionReason> {
        validate_export_request(request).map_err(RejectionReason::Contract)?;
        let inner = self.lock();
        let mut gaps = inner.gaps.iter().cloned().collect::<Vec<_>>();
        if let Some(to_cursor) = inner.evicted_through_cursor {
            gaps.insert(
                0,
                GapV1 {
                    reason: GapReasonV1::Evicted,
                    from_cursor: Some(1),
                    to_cursor: Some(to_cursor),
                    component: None,
                    producer_boot_id: None,
                    missing_sequence_from: None,
                    missing_sequence_to: None,
                    dropped_records: to_cursor,
                },
            );
        }
        gaps.truncate(proliferate_diagnostics_protocol::v1::limits::MAX_CARDINALITY_ENTRIES);

        let mut selected = Vec::new();
        let mut selected_bytes = 0_u64;
        let mut versions = BTreeMap::<SchemaVersionV1, u64>::new();
        for stored in &inner.records {
            if selected.len() == request.record_limit as usize {
                break;
            }
            let accepted = stored.decode().map_err(|_| RejectionReason::Core)?;
            if !record_matches(&accepted, &request.filters) {
                continue;
            }
            let record_bytes = stored.encoded.len() as u64;
            if selected_bytes.saturating_add(record_bytes) > request.byte_limit {
                break;
            }
            selected_bytes += record_bytes;
            *versions.entry(stored.version).or_default() += 1;
            selected.push(stored.clone());
        }
        let cursor_start = selected.first().map(|record| record.cursor);
        let cursor_end = selected.last().map(|record| record.cursor);
        let manifest = ExportManifestV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            snapshot_id: format!("snapshot-{}", uuid::Uuid::new_v4()),
            generated_at: timestamp_now(),
            record_count: selected.len() as u32,
            byte_count: selected_bytes,
            cursor_start,
            cursor_end,
            gaps: gaps.clone(),
            versions_present: versions
                .into_iter()
                .map(|(version, records)| VersionCountV1 { version, records })
                .collect(),
            filters: request.filters.clone(),
            redaction: if request.purpose == ExportPurposeV1::Support {
                RedactionClassificationV1::SupportExport
            } else {
                RedactionClassificationV1::None
            },
            includes_health: request.include_health,
        };
        validate_export_manifest(&manifest).map_err(RejectionReason::Contract)?;
        let health = request
            .include_health
            .then(|| self.health_locked(&inner))
            .transpose()
            .map_err(|_| RejectionReason::Core)?;
        Ok(ExportSnapshot {
            manifest,
            records: selected,
            gaps,
            health,
            record_bytes: selected_bytes,
        })
    }
}

#[derive(Debug)]
pub(crate) enum RejectionReason {
    Contract(proliferate_diagnostics_protocol::v1::types::RejectionReasonV1),
    Core,
}

impl RejectionReason {
    pub(crate) fn contract_reason(
        &self,
    ) -> proliferate_diagnostics_protocol::v1::types::RejectionReasonV1 {
        match self {
            Self::Contract(reason) => *reason,
            Self::Core => {
                proliferate_diagnostics_protocol::v1::types::RejectionReasonV1::InvalidShape
            }
        }
    }
}

fn eviction_gap(
    after_cursor: u64,
    evicted_through: Option<u64>,
    oldest_retained: Option<u64>,
) -> Option<GapV1> {
    let to_cursor = evicted_through?;
    let first_missing = after_cursor.saturating_add(1);
    if first_missing > to_cursor || oldest_retained.is_some_and(|oldest| first_missing >= oldest) {
        return None;
    }
    Some(GapV1 {
        reason: GapReasonV1::Evicted,
        from_cursor: Some(first_missing),
        to_cursor: Some(to_cursor),
        component: None,
        producer_boot_id: None,
        missing_sequence_from: None,
        missing_sequence_to: None,
        dropped_records: to_cursor.saturating_sub(first_missing).saturating_add(1),
    })
}

fn record_matches(record: &CollectorAcceptedRecordV1, filters: &RecordsFilterV1) -> bool {
    let record = &record.record;
    if filters
        .source_time_from
        .as_deref()
        .is_some_and(|from| timestamp_before(&record.source_timestamp, from))
        || filters
            .source_time_to
            .as_deref()
            .is_some_and(|to| timestamp_after(&record.source_timestamp, to))
        || (!filters.components.is_empty() && !filters.components.contains(&record.component))
        || (!filters.record_classes.is_empty()
            && !filters.record_classes.contains(&record.record_class))
        || (!filters.severities.is_empty() && !filters.severities.contains(&record.severity))
        || (!filters.names.is_empty() && !filters.names.contains(&record.name))
        || (!filters.outcomes.is_empty()
            && !record.lifecycle.as_ref().is_some_and(|lifecycle| {
                lifecycle
                    .outcome
                    .is_some_and(|outcome| filters.outcomes.contains(&outcome))
            }))
    {
        return false;
    }
    matches_optional(&filters.operation_id, Some(&record.operation_id))
        && matches_optional(
            &filters.parent_operation_id,
            record.parent_operation_id.as_ref(),
        )
        && matches_optional(&filters.trace_id, record.trace_id.as_ref())
        && matches_optional(&filters.workspace_id, record.workspace_id.as_ref())
        && matches_optional(&filters.session_id, record.session_id.as_ref())
        && matches_optional(&filters.turn_id, record.turn_id.as_ref())
        && matches_optional(&filters.item_id, record.item_id.as_ref())
        && matches_optional(&filters.request_id, record.request_id.as_ref())
        && matches_optional(&filters.target_id, record.target_id.as_ref())
        && matches_optional(&filters.prompt_id, record.prompt_id.as_ref())
        && matches_optional(&filters.workflow_id, record.workflow_id.as_ref())
        && matches_optional(
            &filters.error_classification,
            record.error_classification.as_ref(),
        )
}

fn matches_optional(filter: &Option<String>, value: Option<&String>) -> bool {
    filter.as_ref().is_none_or(|filter| value == Some(filter))
}

fn timestamp_before(value: &str, lower_bound: &str) -> bool {
    compare_timestamp(value, lower_bound).is_lt()
}

fn timestamp_after(value: &str, upper_bound: &str) -> bool {
    compare_timestamp(value, upper_bound).is_gt()
}

fn compare_timestamp(left: &str, right: &str) -> std::cmp::Ordering {
    match (
        DateTime::parse_from_rfc3339(left),
        DateTime::parse_from_rfc3339(right),
    ) {
        (Ok(left), Ok(right)) => left.cmp(&right),
        _ => left.cmp(right),
    }
}

pub(crate) fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
