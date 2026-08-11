use std::collections::BTreeMap;

use proliferate_diagnostics_protocol::v1::limits::CURRENT_SCHEMA_VERSION;
use proliferate_diagnostics_protocol::v1::types::{
    ExporterHealthV1, ExporterStateV1, FallbackHealthV1, FallbackStateV1, HealthResponseV1,
    HealthStatusV1, PressureV1,
};
use proliferate_diagnostics_protocol::v1::validation::validate_health;

use super::{CollectorCore, CoreError};

impl CollectorCore {
    pub fn health(&self) -> Result<HealthResponseV1, CoreError> {
        let inner = self.lock();
        self.health_locked(&inner)
    }

    pub(crate) fn health_locked(
        &self,
        inner: &super::Inner,
    ) -> Result<HealthResponseV1, CoreError> {
        let pressure = self.pressure_locked(inner);
        let status = if inner.status == HealthStatusV1::Ready && pressure == PressureV1::Critical {
            HealthStatusV1::Degraded
        } else {
            inner.status
        };
        let mut cardinality_counts = BTreeMap::new();
        cardinality_counts.insert(
            "lifecycle_operations".to_owned(),
            inner.lifecycle.len() as u64,
        );
        cardinality_counts.insert("producers".to_owned(), inner.producers.len() as u64);
        cardinality_counts.insert("retained_records".to_owned(), inner.records.len() as u64);
        cardinality_counts.insert(
            "tail_readers".to_owned(),
            (self.limits.tail_readers - self.tail_slots.available_permits()) as u64,
        );
        let health = HealthResponseV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            status,
            collector_boot_id: self.boot_id.clone(),
            restart_count: 0,
            pressure,
            oldest_cursor: inner.records.front().map(|record| record.cursor),
            newest_cursor: inner.records.back().map(|record| record.cursor),
            retained_bytes: inner.retained_bytes,
            evictions_by_class: inner.counters.evictions_by_class.clone(),
            evictions_by_component: inner.counters.evictions_by_component.clone(),
            evictions_by_reason: inner.counters.evictions_by_reason.clone(),
            rejections_by_reason: inner.counters.rejections_by_reason.clone(),
            cardinality_counts,
            rejected_records: inner.counters.rejected_records,
            oversized_records: inner.counters.oversized_records,
            duplicate_terminals: inner.counters.duplicate_terminals,
            conflicting_terminals: inner.counters.conflicting_terminals,
            producers: inner
                .producers
                .values()
                .map(|producer| producer.health.clone())
                .collect(),
            tail_reader_drops: inner.counters.tail_reader_drops,
            exporter: ExporterHealthV1 {
                state: ExporterStateV1::Disabled,
                dropped_records: 0,
                last_error_classification: None,
            },
            fallback: FallbackHealthV1 {
                state: FallbackStateV1::Inactive,
                bytes: 0,
                dropped_records: 0,
            },
        };
        validate_health(&health).map_err(|_| CoreError::Serialization)?;
        Ok(health)
    }

    pub fn note_tail_drop(&self, dropped_frames: u64) {
        let mut inner = self.lock();
        inner.counters.tail_reader_drops = inner
            .counters
            .tail_reader_drops
            .saturating_add(dropped_frames);
    }
}
