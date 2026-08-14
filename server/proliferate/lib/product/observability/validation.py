from typing import cast

from proliferate.lib.product.observability.contract import (
    CollectorAcceptedRecordV1,
    ConnectionDescriptorV1,
    ExportManifestV1,
    ExportRequestV1,
    ExportStreamFrameV1,
    HealthResponseV1,
    IngestBatchV1,
    IngestReceiptV1,
    ProducerRecordV1,
    RecordsPageV1,
    RecordsQueryV1,
    RssMeasurementProfileV1,
    TailFrameV1,
)
from proliferate.lib.product.observability.limits import (
    COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
    CURRENT_SCHEMA_VERSION,
    MAX_ARGUMENT_LIST_ITEMS,
    MAX_ARGUMENTS,
    MAX_BATCH_BYTES,
    MAX_BATCH_RECORDS,
    MAX_CARDINALITY_ENTRIES,
    MAX_EXPORT_BYTES,
    MAX_EXPORT_RECORDS,
    MAX_HEALTH_PRODUCERS,
    MAX_PAGE_RECORDS,
    MAX_RECORD_BYTES,
    MAX_STRING_BYTES,
    MAX_TAIL_FRAME_RECORDS,
    MAX_VERSIONS_PRESENT,
    RETAINED_RECORD_ARENA_LIMIT_BYTES,
)
from proliferate.lib.product.observability.validation_support import (
    COMPONENTS,
    LOOPBACK_PATTERN,
    PRIVACY,
    RECORD_CLASSES,
    REDACTION,
    REJECTION_REASONS,
    SEVERITIES,
    SOURCES,
    _fail,
    _json_byte_length,
    _optional_id,
    _optional_name,
    _optional_nonnegative_int,
    _parse_detailed,
    _parse_exporter_health,
    _parse_fallback_health,
    _parse_filters,
    _parse_gap,
    _parse_ingest_rejection,
    _parse_lifecycle,
    _parse_producer_health,
    _parse_schema_version,
    _parse_typed_argument,
    _parse_version_count,
    _reject_prohibited_model_plugin_metadata,
    _reject_secret_fields,
    _require_bool,
    _require_bounded_string,
    _require_dict,
    _require_enum,
    _require_id,
    _require_list,
    _require_name,
    _require_nonnegative_int,
    _require_positive_int,
    _require_short_string,
    _require_string,
    _require_timestamp,
    _set_optional,
)


def parse_producer_record_v1(value: object) -> ProducerRecordV1:
    raw = _require_dict(value)
    if _json_byte_length(raw) > MAX_RECORD_BYTES:
        _fail("record_too_large")
    _reject_secret_fields(raw)
    _reject_prohibited_model_plugin_metadata(raw)

    schema_version = _parse_schema_version(raw.get("schema_version"))
    record_class = _require_enum(raw.get("record_class"), RECORD_CLASSES)
    privacy = _require_enum(raw.get("privacy"), PRIVACY)
    if privacy == "secret":
        _fail("prohibited_secret")

    argument_values = _require_list(raw.get("arguments"))
    if len(argument_values) > MAX_ARGUMENTS:
        _fail("limit_exceeded")
    arguments = [_parse_typed_argument(argument) for argument in argument_values]
    name = _require_name(raw.get("name"))
    error_classification = _optional_name(raw.get("error_classification"))
    detailed = None if raw.get("detailed") is None else _parse_detailed(raw["detailed"])
    lifecycle = None if raw.get("lifecycle") is None else _parse_lifecycle(raw["lifecycle"], name)

    if (
        record_class == "detailed"
        and (detailed is None or lifecycle is not None)
        or record_class == "lifecycle"
        and (lifecycle is None or detailed is not None)
    ):
        _fail("invalid_shape")
    if (
        lifecycle is not None
        and lifecycle["phase"] == "terminal"
        and lifecycle.get("outcome") == "failed"
        and error_classification is None
    ):
        _fail("invalid_shape")

    record: dict[str, object] = {
        "schema_version": schema_version,
        "source_timestamp": _require_timestamp(raw.get("source_timestamp")),
        "producer_sequence": _require_nonnegative_int(raw.get("producer_sequence")),
        "producer_boot_id": _require_id(raw.get("producer_boot_id")),
        "component": _require_enum(raw.get("component"), COMPONENTS),
        "source": _require_enum(raw.get("source"), SOURCES),
        "release": _require_short_string(raw.get("release")),
        "environment": _require_short_string(raw.get("environment")),
        "operation_id": _require_id(raw.get("operation_id")),
        "name": name,
        "severity": _require_enum(raw.get("severity"), SEVERITIES),
        "arguments": arguments,
        "record_class": record_class,
        "privacy": privacy,
        "redaction": _require_enum(raw.get("redaction"), REDACTION),
    }
    for key in (
        "parent_operation_id",
        "trace_id",
        "workspace_id",
        "session_id",
        "turn_id",
        "item_id",
        "request_id",
        "target_id",
        "prompt_id",
        "workflow_id",
    ):
        _set_optional(record, key, _optional_id(raw.get(key)))
    _set_optional(record, "error_classification", error_classification)
    _set_optional(record, "detailed", detailed)
    _set_optional(record, "lifecycle", lifecycle)
    return cast(ProducerRecordV1, record)


def parse_connection_descriptor_v1(value: object) -> ConnectionDescriptorV1:
    raw = _require_dict(value)
    _reject_secret_fields(raw)
    schema_major = _require_nonnegative_int(raw.get("schema_major"))
    if schema_major != CURRENT_SCHEMA_VERSION["major"]:
        _fail("unsupported_major")
    endpoint = _require_string(raw.get("endpoint"))
    match = LOOPBACK_PATTERN.fullmatch(endpoint)
    if match is None or int(match.group(1)) > 65_535:
        _fail("invalid_shape")
    token_reference = _require_dict(raw.get("token_reference"))
    kind = _require_enum(
        token_reference.get("kind"), frozenset({"inherited_file_descriptor", "process_memory"})
    )
    reference = _require_id(token_reference.get("reference"))
    if kind == "inherited_file_descriptor" and (
        not reference.isascii() or not reference.isdecimal() or int(reference) > 4_294_967_295
    ):
        _fail("invalid_shape")
    return cast(
        ConnectionDescriptorV1,
        {
            "endpoint": endpoint,
            "token_reference": {"kind": kind, "reference": reference},
            "schema_major": schema_major,
            "collector_boot_id": _require_id(raw.get("collector_boot_id")),
        },
    )


def parse_ingest_batch_v1(value: object) -> IngestBatchV1:
    raw = _require_dict(value)
    if _json_byte_length(raw) > MAX_BATCH_BYTES:
        _fail("batch_too_large")
    records = _require_list(raw.get("records"))
    if len(records) > MAX_BATCH_RECORDS:
        _fail("batch_too_large")
    return {
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "records": [parse_producer_record_v1(record) for record in records],
    }


def parse_collector_accepted_record_v1(value: object) -> CollectorAcceptedRecordV1:
    raw = _require_dict(value)
    return {
        "record": parse_producer_record_v1(raw.get("record")),
        "accepted_timestamp": _require_timestamp(raw.get("accepted_timestamp")),
        "accepted_order": _require_nonnegative_int(raw.get("accepted_order")),
        "retention_cursor": _require_nonnegative_int(raw.get("retention_cursor")),
    }


def parse_ingest_receipt_v1(value: object) -> IngestReceiptV1:
    raw = _require_dict(value)
    rejections = _require_list(raw.get("rejections"))
    if len(rejections) > MAX_BATCH_RECORDS:
        _fail("limit_exceeded")
    result: dict[str, object] = {
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "collector_boot_id": _require_id(raw.get("collector_boot_id")),
        "accepted_count": _require_nonnegative_int(raw.get("accepted_count")),
        "duplicate_count": _require_nonnegative_int(raw.get("duplicate_count")),
        "rejections": [_parse_ingest_rejection(item) for item in rejections],
        "pressure": _require_enum(
            raw.get("pressure"), frozenset({"normal", "elevated", "critical"})
        ),
    }
    if raw.get("accepted_range") is not None:
        accepted_range = _require_dict(raw.get("accepted_range"))
        result["accepted_range"] = {
            "first": _require_nonnegative_int(accepted_range.get("first")),
            "last": _require_nonnegative_int(accepted_range.get("last")),
        }
    return cast(IngestReceiptV1, result)


def parse_records_query_v1(value: object) -> RecordsQueryV1:
    raw = _require_dict(value)
    limit = _require_positive_int(raw.get("limit"))
    if limit > MAX_PAGE_RECORDS:
        _fail("limit_exceeded")
    result: dict[str, object] = {
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "limit": limit,
        "filters": _parse_filters(raw.get("filters")),
    }
    _set_optional(result, "after_cursor", _optional_nonnegative_int(raw.get("after_cursor")))
    return cast(RecordsQueryV1, result)


def parse_records_page_v1(value: object) -> RecordsPageV1:
    raw = _require_dict(value)
    records = _require_list(raw.get("records"))
    gaps = _require_list(raw.get("gaps"))
    versions = _require_list(raw.get("versions_present"))
    if (
        len(records) > MAX_PAGE_RECORDS
        or len(gaps) > MAX_CARDINALITY_ENTRIES
        or len(versions) > MAX_VERSIONS_PRESENT
    ):
        _fail("limit_exceeded")
    result: dict[str, object] = {
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "records": [parse_collector_accepted_record_v1(record) for record in records],
        "gaps": [_parse_gap(gap) for gap in gaps],
        "versions_present": [_parse_version_count(version) for version in versions],
    }
    _set_optional(result, "next_cursor", _optional_nonnegative_int(raw.get("next_cursor")))
    return cast(RecordsPageV1, result)


def parse_tail_frame_v1(value: object) -> TailFrameV1:
    raw = _require_dict(value)
    frame = raw.get("frame")
    if frame == "records":
        records = _require_list(raw.get("records"))
        if len(records) > MAX_TAIL_FRAME_RECORDS:
            _fail("limit_exceeded")
        return cast(
            TailFrameV1,
            {
                "frame": "records",
                "records": [parse_collector_accepted_record_v1(record) for record in records],
                "cursor": _require_nonnegative_int(raw.get("cursor")),
            },
        )
    if frame == "lag":
        return cast(
            TailFrameV1,
            {
                "frame": "lag",
                "dropped_frames": _require_nonnegative_int(raw.get("dropped_frames")),
                "resume_after_cursor": _require_nonnegative_int(raw.get("resume_after_cursor")),
            },
        )
    if frame == "gap":
        return cast(TailFrameV1, {"frame": "gap", "gap": _parse_gap(raw.get("gap"))})
    _fail("invalid_shape")


def parse_export_request_v1(value: object) -> ExportRequestV1:
    raw = _require_dict(value)
    purpose = _require_enum(raw.get("purpose"), frozenset({"support", "internal_dogfood"}))
    authorization = _optional_id(raw.get("support_authorization_id"))
    if (
        purpose == "support"
        and authorization is None
        or purpose == "internal_dogfood"
        and authorization
    ):
        _fail("invalid_shape")
    record_limit = _require_positive_int(raw.get("record_limit"))
    byte_limit = _require_positive_int(raw.get("byte_limit"))
    if record_limit > MAX_EXPORT_RECORDS or byte_limit > MAX_EXPORT_BYTES:
        _fail("limit_exceeded")
    result: dict[str, object] = {
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "purpose": purpose,
        "filters": _parse_filters(raw.get("filters")),
        "record_limit": record_limit,
        "byte_limit": byte_limit,
        "include_health": _require_bool(raw.get("include_health")),
    }
    _set_optional(result, "support_authorization_id", authorization)
    return cast(ExportRequestV1, result)


def parse_export_manifest_v1(value: object) -> ExportManifestV1:
    raw = _require_dict(value)
    record_count = _require_nonnegative_int(raw.get("record_count"))
    byte_count = _require_nonnegative_int(raw.get("byte_count"))
    gaps = _require_list(raw.get("gaps"))
    versions = _require_list(raw.get("versions_present"))
    if (
        record_count > MAX_EXPORT_RECORDS
        or byte_count > MAX_EXPORT_BYTES
        or len(gaps) > MAX_CARDINALITY_ENTRIES
        or len(versions) > MAX_VERSIONS_PRESENT
    ):
        _fail("limit_exceeded")
    result: dict[str, object] = {
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "snapshot_id": _require_id(raw.get("snapshot_id")),
        "generated_at": _require_timestamp(raw.get("generated_at")),
        "record_count": record_count,
        "byte_count": byte_count,
        "gaps": [_parse_gap(gap) for gap in gaps],
        "versions_present": [_parse_version_count(version) for version in versions],
        "filters": _parse_filters(raw.get("filters")),
        "redaction": _require_enum(raw.get("redaction"), REDACTION),
        "includes_health": _require_bool(raw.get("includes_health")),
    }
    _set_optional(result, "cursor_start", _optional_nonnegative_int(raw.get("cursor_start")))
    _set_optional(result, "cursor_end", _optional_nonnegative_int(raw.get("cursor_end")))
    return cast(ExportManifestV1, result)


def parse_export_stream_frame_v1(value: object) -> ExportStreamFrameV1:
    raw = _require_dict(value)
    frame = raw.get("frame")
    if frame == "manifest":
        return cast(
            ExportStreamFrameV1,
            {"frame": "manifest", "manifest": parse_export_manifest_v1(raw.get("manifest"))},
        )
    if frame == "record":
        return cast(
            ExportStreamFrameV1,
            {"frame": "record", "record": parse_collector_accepted_record_v1(raw.get("record"))},
        )
    if frame == "gap":
        return cast(ExportStreamFrameV1, {"frame": "gap", "gap": _parse_gap(raw.get("gap"))})
    if frame == "health":
        return cast(
            ExportStreamFrameV1,
            {"frame": "health", "health": parse_health_response_v1(raw.get("health"))},
        )
    if frame == "end":
        return cast(
            ExportStreamFrameV1,
            {
                "frame": "end",
                "records": _require_nonnegative_int(raw.get("records")),
                "bytes": _require_nonnegative_int(raw.get("bytes")),
            },
        )
    _fail("invalid_shape")


def parse_health_response_v1(value: object) -> HealthResponseV1:
    raw = _require_dict(value)
    retained_bytes = _require_nonnegative_int(raw.get("retained_bytes"))
    producers = _require_list(raw.get("producers"))
    maps = [
        _require_dict(raw.get("evictions_by_class")),
        _require_dict(raw.get("evictions_by_component")),
        _require_dict(raw.get("evictions_by_reason")),
        _require_dict(raw.get("rejections_by_reason")),
        _require_dict(raw.get("cardinality_counts")),
    ]
    if (
        retained_bytes > RETAINED_RECORD_ARENA_LIMIT_BYTES
        or len(producers) > MAX_HEALTH_PRODUCERS
        or any(len(value) > MAX_CARDINALITY_ENTRIES for value in maps)
    ):
        _fail("limit_exceeded")
    allowed_keys = (
        RECORD_CLASSES,
        COMPONENTS,
        frozenset({"evicted", "producer_sequence", "tail_lag", "collector_restart"}),
        REJECTION_REASONS,
        None,
    )
    for count_map, allowed in zip(maps, allowed_keys, strict=True):
        if allowed is not None and any(key not in allowed for key in count_map):
            _fail("invalid_shape")
        for count in count_map.values():
            _require_nonnegative_int(count)
    for key in maps[4]:
        _require_name(key)
    exporter = _require_dict(raw.get("exporter"))
    fallback = _require_dict(raw.get("fallback"))
    result: dict[str, object] = {
        "schema_version": _parse_schema_version(raw.get("schema_version")),
        "status": _require_enum(
            raw.get("status"), frozenset({"starting", "ready", "degraded", "stopping"})
        ),
        "collector_boot_id": _require_id(raw.get("collector_boot_id")),
        "restart_count": _require_nonnegative_int(raw.get("restart_count")),
        "pressure": _require_enum(
            raw.get("pressure"), frozenset({"normal", "elevated", "critical"})
        ),
        "retained_bytes": retained_bytes,
        "evictions_by_class": maps[0],
        "evictions_by_component": maps[1],
        "evictions_by_reason": maps[2],
        "rejections_by_reason": maps[3],
        "cardinality_counts": maps[4],
        "rejected_records": _require_nonnegative_int(raw.get("rejected_records")),
        "oversized_records": _require_nonnegative_int(raw.get("oversized_records")),
        "duplicate_terminals": _require_nonnegative_int(raw.get("duplicate_terminals")),
        "conflicting_terminals": _require_nonnegative_int(raw.get("conflicting_terminals")),
        "producers": [_parse_producer_health(producer) for producer in producers],
        "tail_reader_drops": _require_nonnegative_int(raw.get("tail_reader_drops")),
        "exporter": _parse_exporter_health(exporter),
        "fallback": _parse_fallback_health(fallback),
    }
    _set_optional(result, "oldest_cursor", _optional_nonnegative_int(raw.get("oldest_cursor")))
    _set_optional(result, "newest_cursor", _optional_nonnegative_int(raw.get("newest_cursor")))
    return cast(HealthResponseV1, result)


def parse_rss_measurement_profile_v1(value: object) -> RssMeasurementProfileV1:
    raw = _require_dict(value)
    warmup = _require_dict(raw.get("warmup"))
    concurrency = _require_dict(raw.get("concurrency"))
    stress = _require_dict(raw.get("stress"))
    sampling = _require_dict(raw.get("sampling"))
    pass_fail = _require_dict(raw.get("pass_fail"))
    targets = [_require_string(item) for item in _require_list(raw.get("targets"))]
    required_conditions = [
        _require_string(item) for item in _require_list(pass_fail.get("required_conditions"))
    ]
    steps = [_require_string(item) for item in _require_list(raw.get("steps"))]
    required = [
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
    ]
    if (
        targets != ["aarch64-apple-darwin", "x86_64-apple-darwin"]
        or raw.get("build_profile") != "release"
        or pass_fail.get("total_rss_limit_bytes") != COLLECTOR_TOTAL_RSS_LIMIT_BYTES
        or pass_fail.get("retained_arena_limit_bytes") != RETAINED_RECORD_ARENA_LIMIT_BYTES
        or RETAINED_RECORD_ARENA_LIMIT_BYTES >= COLLECTOR_TOTAL_RSS_LIMIT_BYTES
        or required_conditions != required
        or not steps
        or len(steps) > MAX_ARGUMENT_LIST_ITEMS
    ):
        _fail("invalid_shape")
    return cast(
        RssMeasurementProfileV1,
        {
            "schema_version": _parse_schema_version(raw.get("schema_version")),
            "targets": targets,
            "build_profile": "release",
            "warmup": {
                "duration_seconds": _require_positive_int(warmup.get("duration_seconds")),
                "records": _require_positive_int(warmup.get("records")),
            },
            "concurrency": {
                "ingest_writers": _require_positive_int(concurrency.get("ingest_writers")),
                "query_readers": _require_positive_int(concurrency.get("query_readers")),
                "tail_readers": _require_positive_int(concurrency.get("tail_readers")),
                "export_readers": _require_positive_int(concurrency.get("export_readers")),
            },
            "stress": {
                "duration_seconds": _require_positive_int(stress.get("duration_seconds")),
                "records_per_second": _require_positive_int(stress.get("records_per_second")),
                "oversized_record_every": _require_positive_int(
                    stress.get("oversized_record_every")
                ),
                "slow_tail_delay_ms": _require_positive_int(stress.get("slow_tail_delay_ms")),
                "fail_exporter_after_records": _require_positive_int(
                    stress.get("fail_exporter_after_records")
                ),
            },
            "sampling": {
                "interval_ms": _require_positive_int(sampling.get("interval_ms")),
                "command_template": _require_bounded_string(
                    sampling.get("command_template"), MAX_STRING_BYTES
                ),
                "samples_output": _require_bounded_string(
                    sampling.get("samples_output"), MAX_STRING_BYTES
                ),
            },
            "pass_fail": {
                "total_rss_limit_bytes": COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
                "retained_arena_limit_bytes": RETAINED_RECORD_ARENA_LIMIT_BYTES,
                "required_conditions": required_conditions,
            },
            "steps": [_require_bounded_string(step, MAX_STRING_BYTES) for step in steps],
        },
    )
