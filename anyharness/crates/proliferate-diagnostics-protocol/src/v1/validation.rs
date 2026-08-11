use serde_json::Value;

use super::catalog::is_p0_operation;
use super::limits::{
    COLLECTOR_TOTAL_RSS_LIMIT_BYTES, CURRENT_SCHEMA_VERSION, MAX_ARGUMENTS,
    MAX_ARGUMENT_LIST_ITEMS, MAX_BATCH_BYTES, MAX_BATCH_RECORDS, MAX_CARDINALITY_ENTRIES,
    MAX_EXPORT_BYTES, MAX_EXPORT_RECORDS, MAX_HEALTH_PRODUCERS, MAX_MESSAGE_BYTES,
    MAX_PAGE_RECORDS, MAX_RECORD_BYTES, MAX_STRING_BYTES, MAX_TAIL_FRAME_RECORDS,
    MAX_VERSIONS_PRESENT, RETAINED_RECORD_ARENA_LIMIT_BYTES,
};
use super::types::{
    ConnectionDescriptorV1, ExportManifestV1, ExportPurposeV1, ExportRequestV1,
    ExportStreamFrameV1, HealthResponseV1, IngestBatchV1, IngestReceiptV1, LifecycleFinalizerV1,
    LifecyclePhaseV1, PrivacyClassificationV1, ProducerRecordV1, RecordClassV1, RecordsPageV1,
    RecordsQueryV1, RejectionReasonV1, RssMeasurementProfileV1, TailFrameV1, TerminalOutcomeV1,
    TokenReferenceKindV1,
};
use super::validation_support::*;

pub fn parse_producer_record_value(value: &Value) -> Result<ProducerRecordV1, RejectionReasonV1> {
    if compact_json_len(value)? > MAX_RECORD_BYTES {
        return Err(RejectionReasonV1::RecordTooLarge);
    }
    reject_secret_fields(value)?;
    reject_prohibited_model_plugin_metadata(value)?;
    validate_raw_version(value)?;
    let record: ProducerRecordV1 = from_value(value)?;
    validate_producer_record(&record)?;
    Ok(record)
}

pub fn validate_producer_record(record: &ProducerRecordV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(record)?;
    validate_schema_version(record.schema_version)?;
    validate_timestamp(&record.source_timestamp)?;
    validate_id(&record.producer_boot_id)?;
    validate_short_string(&record.release)?;
    validate_short_string(&record.environment)?;
    validate_id(&record.operation_id)?;
    validate_optional_ids([
        record.parent_operation_id.as_deref(),
        record.trace_id.as_deref(),
        record.workspace_id.as_deref(),
        record.session_id.as_deref(),
        record.turn_id.as_deref(),
        record.item_id.as_deref(),
        record.request_id.as_deref(),
        record.target_id.as_deref(),
        record.prompt_id.as_deref(),
        record.workflow_id.as_deref(),
    ])?;
    validate_name(&record.name)?;
    if record.privacy == PrivacyClassificationV1::Secret {
        return Err(RejectionReasonV1::ProhibitedSecret);
    }
    if record.arguments.len() > MAX_ARGUMENTS {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    for argument in &record.arguments {
        validate_name(&argument.name)?;
        if argument.privacy == PrivacyClassificationV1::Secret {
            return Err(RejectionReasonV1::ProhibitedSecret);
        }
        validate_argument_value(&argument.value, 1)?;
    }
    if let Some(error_classification) = &record.error_classification {
        validate_name(error_classification)?;
    }

    match (&record.record_class, &record.detailed, &record.lifecycle) {
        (RecordClassV1::Detailed, Some(detailed), None) => {
            if let Some(message) = &detailed.message {
                validate_bounded_string(message, MAX_MESSAGE_BYTES)?;
            }
            if let Some(milestone) = &detailed.milestone {
                validate_name(milestone)?;
            }
            if matches!(detailed.kind, super::types::DetailedKindV1::Stdio)
                != detailed.stream.is_some()
            {
                return Err(RejectionReasonV1::InvalidShape);
            }
        }
        (RecordClassV1::Lifecycle, None, Some(lifecycle)) => {
            if !is_p0_operation(&record.name) {
                return Err(RejectionReasonV1::InvalidShape);
            }
            match (lifecycle.phase, lifecycle.outcome) {
                (LifecyclePhaseV1::Started, None) => {}
                (LifecyclePhaseV1::Terminal, Some(_)) => {}
                _ => return Err(RejectionReasonV1::InvalidShape),
            }
            if lifecycle.finalizer == LifecycleFinalizerV1::Collector
                && lifecycle.outcome != Some(TerminalOutcomeV1::Abandoned)
            {
                return Err(RejectionReasonV1::InvalidShape);
            }
            if lifecycle.outcome == Some(TerminalOutcomeV1::Failed)
                && record.error_classification.is_none()
            {
                return Err(RejectionReasonV1::InvalidShape);
            }
            if let Some(model) = &lifecycle.model {
                if record.name != "anyharness.model.request"
                    && record.name != "server.model_gateway.request"
                {
                    return Err(RejectionReasonV1::ProhibitedMetadata);
                }
                validate_id(&model.model_id)?;
                if let Some(provider_kind) = &model.provider_kind {
                    validate_name(provider_kind)?;
                }
            }
            if let Some(plugin) = &lifecycle.plugin {
                if record.name != "anyharness.plugin.invoke" {
                    return Err(RejectionReasonV1::ProhibitedMetadata);
                }
                validate_id(&plugin.plugin_id)?;
                if let Some(kind) = &plugin.kind {
                    validate_name(kind)?;
                }
            }
        }
        _ => return Err(RejectionReasonV1::InvalidShape),
    }
    Ok(())
}

pub fn parse_connection_descriptor_value(
    value: &Value,
) -> Result<ConnectionDescriptorV1, RejectionReasonV1> {
    reject_secret_fields(value)?;
    let descriptor: ConnectionDescriptorV1 = from_value(value)?;
    validate_connection_descriptor(&descriptor)?;
    Ok(descriptor)
}

pub fn validate_connection_descriptor(
    descriptor: &ConnectionDescriptorV1,
) -> Result<(), RejectionReasonV1> {
    if descriptor.schema_major != CURRENT_SCHEMA_VERSION.major {
        return Err(RejectionReasonV1::UnsupportedMajor);
    }
    let port_text = descriptor
        .endpoint
        .strip_prefix("http://127.0.0.1:")
        .ok_or(RejectionReasonV1::InvalidShape)?;
    if port_text.is_empty()
        || port_text.len() > 5
        || port_text.starts_with('0')
        || !port_text.bytes().all(|byte| byte.is_ascii_digit())
        || port_text.parse::<u16>().is_err()
    {
        return Err(RejectionReasonV1::InvalidShape);
    }
    validate_id(&descriptor.collector_boot_id)?;
    validate_id(&descriptor.token_reference.reference)?;
    if descriptor.token_reference.kind == TokenReferenceKindV1::InheritedFileDescriptor
        && (!descriptor
            .token_reference
            .reference
            .bytes()
            .all(|byte| byte.is_ascii_digit())
            || descriptor.token_reference.reference.parse::<u32>().is_err())
    {
        return Err(RejectionReasonV1::InvalidShape);
    }
    Ok(())
}

pub fn parse_ingest_batch_value(value: &Value) -> Result<IngestBatchV1, RejectionReasonV1> {
    if compact_json_len(value)? > MAX_BATCH_BYTES {
        return Err(RejectionReasonV1::BatchTooLarge);
    }
    validate_raw_version(value)?;
    let raw_records = value
        .get("records")
        .and_then(Value::as_array)
        .ok_or(RejectionReasonV1::InvalidShape)?;
    if raw_records.len() > MAX_BATCH_RECORDS {
        return Err(RejectionReasonV1::BatchTooLarge);
    }
    for record in raw_records {
        parse_producer_record_value(record)?;
    }
    let batch: IngestBatchV1 = from_value(value)?;
    Ok(batch)
}

pub fn validate_records_query(query: &RecordsQueryV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(query)?;
    validate_schema_version(query.schema_version)?;
    if query.limit == 0 || query.limit > MAX_PAGE_RECORDS {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    validate_filters(&query.filters)
}

pub fn validate_ingest_receipt(receipt: &IngestReceiptV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(receipt)?;
    validate_schema_version(receipt.schema_version)?;
    validate_id(&receipt.collector_boot_id)?;
    if receipt.rejections.len() > MAX_BATCH_RECORDS {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    Ok(())
}

pub fn validate_records_page(page: &RecordsPageV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(page)?;
    validate_schema_version(page.schema_version)?;
    if page.records.len() > usize::from(MAX_PAGE_RECORDS)
        || page.gaps.len() > MAX_CARDINALITY_ENTRIES
        || page.versions_present.len() > MAX_VERSIONS_PRESENT
    {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    for record in &page.records {
        validate_accepted_record(record)?;
    }
    for gap in &page.gaps {
        validate_gap(gap)?;
    }
    for version in &page.versions_present {
        validate_version_count(version)?;
    }
    Ok(())
}

pub fn validate_tail_frame(frame: &TailFrameV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(frame)?;
    match frame {
        TailFrameV1::Records { records, .. } => {
            if records.len() > MAX_TAIL_FRAME_RECORDS {
                return Err(RejectionReasonV1::LimitExceeded);
            }
            for record in records {
                validate_accepted_record(record)?;
            }
        }
        TailFrameV1::Gap { gap } => validate_gap(gap)?,
        TailFrameV1::Lag { .. } => {}
    }
    Ok(())
}

pub fn validate_export_request(request: &ExportRequestV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(request)?;
    validate_schema_version(request.schema_version)?;
    validate_filters(&request.filters)?;
    if request.record_limit == 0
        || request.record_limit > MAX_EXPORT_RECORDS
        || request.byte_limit == 0
        || request.byte_limit > MAX_EXPORT_BYTES
    {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    match (request.purpose, request.support_authorization_id.as_deref()) {
        (ExportPurposeV1::Support, Some(value)) => validate_id(value),
        (ExportPurposeV1::Support, None) => Err(RejectionReasonV1::InvalidShape),
        (ExportPurposeV1::InternalDogfood, Some(_)) => Err(RejectionReasonV1::InvalidShape),
        (ExportPurposeV1::InternalDogfood, None) => Ok(()),
    }
}

pub fn validate_export_manifest(manifest: &ExportManifestV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(manifest)?;
    validate_schema_version(manifest.schema_version)?;
    validate_id(&manifest.snapshot_id)?;
    validate_timestamp(&manifest.generated_at)?;
    validate_filters(&manifest.filters)?;
    if manifest.record_count > MAX_EXPORT_RECORDS
        || manifest.byte_count > MAX_EXPORT_BYTES
        || manifest.gaps.len() > MAX_CARDINALITY_ENTRIES
        || manifest.versions_present.len() > MAX_VERSIONS_PRESENT
    {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    for gap in &manifest.gaps {
        validate_gap(gap)?;
    }
    for version in &manifest.versions_present {
        validate_version_count(version)?;
    }
    Ok(())
}

pub fn validate_export_frame(frame: &ExportStreamFrameV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(frame)?;
    match frame {
        ExportStreamFrameV1::Manifest { manifest } => validate_export_manifest(manifest),
        ExportStreamFrameV1::Record { record } => validate_accepted_record(record),
        ExportStreamFrameV1::Gap { gap } => validate_gap(gap),
        ExportStreamFrameV1::End { .. } => Ok(()),
        ExportStreamFrameV1::Health { health } => validate_health(health),
    }
}

pub fn validate_health(health: &HealthResponseV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(health)?;
    validate_schema_version(health.schema_version)?;
    validate_id(&health.collector_boot_id)?;
    if health.retained_bytes > RETAINED_RECORD_ARENA_LIMIT_BYTES
        || health.producers.len() > MAX_HEALTH_PRODUCERS
        || map_too_large(&health.evictions_by_class)
        || map_too_large(&health.evictions_by_component)
        || map_too_large(&health.evictions_by_reason)
        || map_too_large(&health.rejections_by_reason)
        || map_too_large(&health.cardinality_counts)
    {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    for producer in &health.producers {
        validate_id(&producer.producer_boot_id)?;
        validate_schema_version(producer.schema_version)?;
    }
    for key in health.cardinality_counts.keys() {
        validate_name(key)?;
    }
    if let Some(classification) = &health.exporter.last_error_classification {
        validate_name(classification)?;
    }
    Ok(())
}

pub fn validate_rss_profile(profile: &RssMeasurementProfileV1) -> Result<(), RejectionReasonV1> {
    validate_serializable_safe_integers(profile)?;
    validate_schema_version(profile.schema_version)?;
    if profile.targets != ["aarch64-apple-darwin", "x86_64-apple-darwin"]
        || profile.build_profile != "release"
        || profile.warmup.duration_seconds == 0
        || profile.warmup.records == 0
        || profile.concurrency.ingest_writers == 0
        || profile.concurrency.query_readers == 0
        || profile.concurrency.tail_readers == 0
        || profile.concurrency.export_readers == 0
        || profile.stress.duration_seconds == 0
        || profile.stress.records_per_second == 0
        || profile.stress.oversized_record_every == 0
        || profile.stress.slow_tail_delay_ms == 0
        || profile.stress.fail_exporter_after_records == 0
        || profile.sampling.interval_ms == 0
        || profile.pass_fail.total_rss_limit_bytes != COLLECTOR_TOTAL_RSS_LIMIT_BYTES
        || profile.pass_fail.retained_arena_limit_bytes != RETAINED_RECORD_ARENA_LIMIT_BYTES
        || profile.pass_fail.retained_arena_limit_bytes >= profile.pass_fail.total_rss_limit_bytes
        || profile.steps.is_empty()
        || profile.steps.len() > MAX_ARGUMENT_LIST_ITEMS
    {
        return Err(RejectionReasonV1::InvalidShape);
    }
    validate_bounded_string(&profile.sampling.command_template, MAX_STRING_BYTES)?;
    validate_bounded_string(&profile.sampling.samples_output, MAX_STRING_BYTES)?;
    for step in &profile.steps {
        validate_bounded_string(step, MAX_STRING_BYTES)?;
    }
    let required = [
        "warm_up",
        "concurrent_ingest",
        "concurrent_query",
        "concurrent_tail",
        "concurrent_export",
        "oversized_input",
        "slow_reader",
        "failed_exporter",
        "sample_total_rss",
        "assert_responsive",
        "assert_counters_and_gaps",
    ];
    if profile.pass_fail.required_conditions != required {
        return Err(RejectionReasonV1::InvalidShape);
    }
    Ok(())
}
