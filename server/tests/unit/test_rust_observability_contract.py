import json
from pathlib import Path

import pytest

from proliferate.lib.product.observability import limits
from proliferate.lib.product.observability.catalog import (
    P0_OPERATION_FAMILIES,
    P0_OPERATION_NAMES,
)
from proliferate.lib.product.observability.sequence import LifecycleSequenceValidatorV1
from proliferate.lib.product.observability.validation import (
    parse_collector_accepted_record_v1,
    parse_connection_descriptor_v1,
    parse_export_manifest_v1,
    parse_export_request_v1,
    parse_export_stream_frame_v1,
    parse_health_response_v1,
    parse_ingest_batch_v1,
    parse_ingest_receipt_v1,
    parse_producer_record_v1,
    parse_records_page_v1,
    parse_records_query_v1,
    parse_rss_measurement_profile_v1,
    parse_tail_frame_v1,
)
from proliferate.lib.product.observability.validation_error import (
    DiagnosticsContractErrorV1,
)

FIXTURE_ROOT = Path(__file__).resolve().parents[3] / "fixtures/contracts/rust-observability-v1"


def _fixture(relative: str):
    return json.loads((FIXTURE_ROOT / relative).read_text(encoding="utf-8"))


def _reason(callback):
    with pytest.raises(DiagnosticsContractErrorV1) as caught:
        callback()
    return caught.value.reason


def _compact_bytes(value) -> int:
    return len(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode(
            "utf-8"
        )
    )


def test_valid_records_roundtrip_and_cover_every_terminal_outcome() -> None:
    fixture = _fixture("valid/records.json")
    records = [parse_producer_record_v1(record) for record in fixture["records"]]

    assert records == fixture["records"]
    assert {record["record_class"] for record in records} == {"detailed", "lifecycle"}
    assert {
        record["lifecycle"]["outcome"]
        for record in records
        if "lifecycle" in record and "outcome" in record["lifecycle"]
    } == {
        "succeeded",
        "failed",
        "cancelled",
        "timed_out",
        "abandoned",
        "rejected",
        "skipped",
    }
    assert any(record.get("lifecycle", {}).get("model") for record in records)
    assert any(record.get("lifecycle", {}).get("plugin") for record in records)


def test_previous_minor_and_unknown_optional_fields_are_canonicalized() -> None:
    fixture = _fixture("valid/unknown-optional.json")
    assert parse_producer_record_v1(fixture["input"]) == fixture["canonical"]


def test_lifecycle_sequences_pin_retry_conflict_death_and_orphan_behavior() -> None:
    records = [
        parse_producer_record_v1(record) for record in _fixture("valid/records.json")["records"]
    ]
    for scenario in _fixture("valid/lifecycle-sequences.json")["scenarios"]:
        validator = LifecycleSequenceValidatorV1()
        for index, expected in zip(scenario["record_indexes"], scenario["expected"], strict=True):
            if "error" in expected:
                assert (
                    _reason(
                        lambda index=index, validator=validator: validator.apply(records[index])
                    )
                    == expected["error"]
                )
                continue
            decision = validator.apply(records[index])
            assert decision["disposition"] == expected["disposition"]
            assert (
                decision["requires_gap_or_health_violation"]
                == expected["requires_gap_or_health_violation"]
            )
            if scenario["name"] == "structurally_valid_orphan_terminal":
                assert expected["invented_start"] is False
                assert expected["invented_failure"] is False


def test_every_invalid_record_rejects_for_the_pinned_reason() -> None:
    for case in _fixture("invalid/records.json")["cases"]:
        assert _reason(lambda case=case: parse_producer_record_v1(case["input"])) == case["reason"]


def test_all_api_shapes_parse_and_roundtrip() -> None:
    fixture = _fixture("valid/api.json")

    assert (
        parse_connection_descriptor_v1(fixture["connection_descriptor"])
        == fixture["connection_descriptor"]
    )
    assert (
        parse_collector_accepted_record_v1(fixture["collector_record"])
        == fixture["collector_record"]
    )
    assert parse_ingest_batch_v1(fixture["ingest_batch"]) == fixture["ingest_batch"]
    assert parse_ingest_receipt_v1(fixture["ingest_receipt"]) == fixture["ingest_receipt"]
    assert parse_records_query_v1(fixture["records_query"]) == fixture["records_query"]
    assert parse_records_page_v1(fixture["records_page"]) == fixture["records_page"]
    assert [parse_tail_frame_v1(frame) for frame in fixture["tail_frames"]] == fixture[
        "tail_frames"
    ]
    assert parse_export_request_v1(fixture["export_request"]) == fixture["export_request"]
    assert parse_export_manifest_v1(fixture["export_manifest"]) == fixture["export_manifest"]
    assert parse_health_response_v1(fixture["health"]) == fixture["health"]
    assert [parse_export_stream_frame_v1(frame) for frame in fixture["export_frames"]] == fixture[
        "export_frames"
    ]


def test_every_invalid_api_shape_rejects_for_the_pinned_reason() -> None:
    parsers = {
        "connection_descriptor": parse_connection_descriptor_v1,
        "records_query": parse_records_query_v1,
        "records_page": parse_records_page_v1,
        "export_request": parse_export_request_v1,
        "health": parse_health_response_v1,
    }
    for case in _fixture("invalid/api.json")["cases"]:
        assert _reason(lambda case=case: parsers[case["kind"]](case["input"])) == case["reason"]


def test_closed_operation_catalog_matches_the_golden_fixture() -> None:
    fixture = _fixture("operation-catalog.json")
    assert [
        {
            "pattern": family.pattern,
            "operations": list(family.operations),
            "semantic_owner": family.semantic_owner,
            "boundary": family.boundary,
            "owning_pr": family.owning_pr,
        }
        for family in P0_OPERATION_FAMILIES
    ] == fixture["families"]
    assert len(P0_OPERATION_NAMES) == 91


def test_all_limits_and_release_rss_profile_match_golden_fixtures() -> None:
    fixture = _fixture("limits.json")
    assert fixture["limits"] == {
        "max_safe_integer": limits.MAX_SAFE_INTEGER,
        "max_record_bytes": limits.MAX_RECORD_BYTES,
        "max_string_bytes": limits.MAX_STRING_BYTES,
        "max_message_bytes": limits.MAX_MESSAGE_BYTES,
        "max_name_bytes": limits.MAX_NAME_BYTES,
        "max_id_bytes": limits.MAX_ID_BYTES,
        "max_arguments": limits.MAX_ARGUMENTS,
        "max_argument_list_items": limits.MAX_ARGUMENT_LIST_ITEMS,
        "max_argument_object_fields": limits.MAX_ARGUMENT_OBJECT_FIELDS,
        "max_argument_depth": limits.MAX_ARGUMENT_DEPTH,
        "max_batch_records": limits.MAX_BATCH_RECORDS,
        "max_batch_bytes": limits.MAX_BATCH_BYTES,
        "max_filter_values": limits.MAX_FILTER_VALUES,
        "default_page_records": limits.DEFAULT_PAGE_RECORDS,
        "max_page_records": limits.MAX_PAGE_RECORDS,
        "max_tail_frame_records": limits.MAX_TAIL_FRAME_RECORDS,
        "max_export_records": limits.MAX_EXPORT_RECORDS,
        "max_export_bytes": limits.MAX_EXPORT_BYTES,
        "max_cardinality_entries": limits.MAX_CARDINALITY_ENTRIES,
        "max_versions_present": limits.MAX_VERSIONS_PRESENT,
        "max_health_producers": limits.MAX_HEALTH_PRODUCERS,
        "collector_total_rss_limit_bytes": limits.COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
        "retained_record_arena_limit_bytes": limits.RETAINED_RECORD_ARENA_LIMIT_BYTES,
    }
    assert fixture["supported_previous_producer_minor_window"] == (
        limits.SUPPORTED_PREVIOUS_PRODUCER_MINOR_WINDOW
    )
    rss_fixture = _fixture("rss-profile.json")
    assert parse_rss_measurement_profile_v1(rss_fixture) == rss_fixture
    assert limits.RETAINED_RECORD_ARENA_LIMIT_BYTES < limits.COLLECTOR_TOTAL_RSS_LIMIT_BYTES


def test_representative_exact_byte_and_cardinality_boundaries() -> None:
    base = _fixture("valid/records.json")["records"][0]
    id_record = json.loads(json.dumps(base))
    id_record["operation_id"] = "a" * limits.MAX_ID_BYTES
    assert parse_producer_record_v1(id_record)["operation_id"] == "a" * limits.MAX_ID_BYTES
    id_record["operation_id"] += "a"
    assert _reason(lambda: parse_producer_record_v1(id_record)) == "limit_exceeded"

    padded = json.loads(json.dumps(base))
    padded["future_padding"] = ""
    record_overhead = _compact_bytes(padded)
    padded["future_padding"] = "x" * (limits.MAX_RECORD_BYTES - record_overhead)
    assert _compact_bytes(padded) == limits.MAX_RECORD_BYTES
    parse_producer_record_v1(padded)
    padded["future_padding"] += "x"
    assert _reason(lambda: parse_producer_record_v1(padded)) == "record_too_large"

    batch = {
        "schema_version": limits.CURRENT_SCHEMA_VERSION,
        "records": [base],
        "future_padding": "",
    }
    batch_overhead = _compact_bytes(batch)
    batch["future_padding"] = "x" * (limits.MAX_BATCH_BYTES - batch_overhead)
    assert _compact_bytes(batch) == limits.MAX_BATCH_BYTES
    parse_ingest_batch_v1(batch)
    batch["future_padding"] += "x"
    assert _reason(lambda: parse_ingest_batch_v1(batch)) == "batch_too_large"

    health = _fixture("valid/api.json")["health"]
    health["cardinality_counts"] = {
        f"key.{index}": index for index in range(limits.MAX_CARDINALITY_ENTRIES)
    }
    parse_health_response_v1(health)
    health["cardinality_counts"][f"key.{limits.MAX_CARDINALITY_ENTRIES}"] = 1
    assert _reason(lambda: parse_health_response_v1(health)) == "limit_exceeded"
