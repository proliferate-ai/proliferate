import { describe, expect, it } from "vitest";
import invalidApiFixture from "../../../../../fixtures/contracts/rust-observability-v1/invalid/api.json";
import invalidRecordsFixture from "../../../../../fixtures/contracts/rust-observability-v1/invalid/records.json";
import limitsFixture from "../../../../../fixtures/contracts/rust-observability-v1/limits.json";
import operationCatalogFixture from "../../../../../fixtures/contracts/rust-observability-v1/operation-catalog.json";
import rssProfileFixture from "../../../../../fixtures/contracts/rust-observability-v1/rss-profile.json";
import apiFixture from "../../../../../fixtures/contracts/rust-observability-v1/valid/api.json";
import sequenceFixture from "../../../../../fixtures/contracts/rust-observability-v1/valid/lifecycle-sequences.json";
import recordsFixture from "../../../../../fixtures/contracts/rust-observability-v1/valid/records.json";
import unknownOptionalFixture from "../../../../../fixtures/contracts/rust-observability-v1/valid/unknown-optional.json";
import {
  P0_OPERATION_FAMILIES,
  P0_OPERATION_NAMES,
} from "../domain/diagnostics/catalog";
import type { RejectionReasonV1 } from "../domain/diagnostics/contract";
import * as limits from "../domain/diagnostics/limits";
import { LifecycleSequenceValidatorV1 } from "../domain/diagnostics/sequence";
import { DiagnosticsContractErrorV1 } from "../domain/diagnostics/validation-scalars";
import {
  parseCollectorAcceptedRecordV1,
  parseConnectionDescriptorV1,
  parseExportManifestV1,
  parseExportRequestV1,
  parseExportStreamFrameV1,
  parseHealthResponseV1,
  parseIngestBatchV1,
  parseIngestReceiptV1,
  parseProducerRecordV1,
  parseRecordsPageV1,
  parseRecordsQueryV1,
  parseRssMeasurementProfileV1,
  parseTailFrameV1,
} from "../domain/diagnostics/validation";

describe("rust observability v1 golden contract", () => {
  it("roundtrips valid detailed/lifecycle records and every terminal outcome", () => {
    const parsed = recordsFixture.records.map(parseProducerRecordV1);
    expect(parsed).toEqual(recordsFixture.records);
    expect(new Set(parsed.map((record) => record.record_class))).toEqual(
      new Set(["detailed", "lifecycle"]),
    );
    expect(
      new Set(
        parsed.flatMap((record) =>
          record.lifecycle?.outcome === undefined ? [] : [record.lifecycle.outcome],
        ),
      ),
    ).toEqual(
      new Set([
        "succeeded",
        "failed",
        "cancelled",
        "timed_out",
        "abandoned",
        "rejected",
        "skipped",
      ]),
    );
    expect(parsed.some((record) => record.lifecycle?.model !== undefined)).toBe(true);
    expect(parsed.some((record) => record.lifecycle?.plugin !== undefined)).toBe(true);
  });

  it("accepts the previous minor and drops unknown optional fields", () => {
    expect(parseProducerRecordV1(unknownOptionalFixture.input)).toEqual(
      unknownOptionalFixture.canonical,
    );
  });

  it("pins start, retry, terminal, conflict, death, and orphan decisions", () => {
    const records = recordsFixture.records.map(parseProducerRecordV1);
    for (const scenario of sequenceFixture.scenarios) {
      const validator = new LifecycleSequenceValidatorV1();
      scenario.record_indexes.forEach((index, step) => {
        const expected = scenario.expected[step];
        if ("error" in expected) {
          expect(rejectionReason(() => validator.apply(records[index]))).toBe(expected.error);
          return;
        }
        const decision = validator.apply(records[index]);
        expect(decision.disposition).toBe(expected.disposition);
        expect(decision.requires_gap_or_health_violation).toBe(
          expected.requires_gap_or_health_violation,
        );
        if (scenario.name === "structurally_valid_orphan_terminal") {
          expect("invented_start" in expected && expected.invented_start).toBe(false);
          expect("invented_failure" in expected && expected.invented_failure).toBe(false);
        }
      });
    }
  });

  it("rejects every invalid record for its pinned reason", () => {
    for (const testCase of invalidRecordsFixture.cases) {
      expect(rejectionReason(() => parseProducerRecordV1(testCase.input))).toBe(
        testCase.reason,
      );
    }
  });

  it("parses and roundtrips every API shape", () => {
    expect(parseConnectionDescriptorV1(apiFixture.connection_descriptor)).toEqual(
      apiFixture.connection_descriptor,
    );
    expect(parseCollectorAcceptedRecordV1(apiFixture.collector_record)).toEqual(
      apiFixture.collector_record,
    );
    expect(parseIngestBatchV1(apiFixture.ingest_batch)).toEqual(apiFixture.ingest_batch);
    expect(parseIngestReceiptV1(apiFixture.ingest_receipt)).toEqual(apiFixture.ingest_receipt);
    expect(parseRecordsQueryV1(apiFixture.records_query)).toEqual(apiFixture.records_query);
    expect(parseRecordsPageV1(apiFixture.records_page)).toEqual(apiFixture.records_page);
    expect(apiFixture.tail_frames.map(parseTailFrameV1)).toEqual(apiFixture.tail_frames);
    expect(parseExportRequestV1(apiFixture.export_request)).toEqual(apiFixture.export_request);
    expect(parseExportManifestV1(apiFixture.export_manifest)).toEqual(
      apiFixture.export_manifest,
    );
    expect(parseHealthResponseV1(apiFixture.health)).toEqual(apiFixture.health);
    expect(apiFixture.export_frames.map(parseExportStreamFrameV1)).toEqual(
      apiFixture.export_frames,
    );
  });

  it("rejects every invalid API shape for its pinned reason", () => {
    for (const testCase of invalidApiFixture.cases) {
      const parse = () => {
        switch (testCase.kind) {
          case "connection_descriptor":
            return parseConnectionDescriptorV1(testCase.input);
          case "collector_record":
            return parseCollectorAcceptedRecordV1(testCase.input);
          case "records_query":
            return parseRecordsQueryV1(testCase.input);
          case "records_page":
            return parseRecordsPageV1(testCase.input);
          case "tail_frame":
            return parseTailFrameV1(testCase.input);
          case "export_request":
            return parseExportRequestV1(testCase.input);
          case "export_frame":
            return parseExportStreamFrameV1(testCase.input);
          case "health":
            return parseHealthResponseV1(testCase.input);
          default:
            throw new Error(`unknown invalid API fixture kind: ${testCase.kind}`);
        }
      };
      expect(rejectionReason(parse)).toBe(testCase.reason);
    }
  });

  it("pins the exact closed operation catalog", () => {
    expect(
      P0_OPERATION_FAMILIES.map((family) => ({
        pattern: family.pattern,
        operations: family.operations,
        semantic_owner: family.semanticOwner,
        boundary: family.boundary,
        owning_pr: family.owningPr,
      })),
    ).toEqual(operationCatalogFixture.families);
    expect(P0_OPERATION_NAMES).toHaveLength(91);
  });

  it("pins every bound and validates the release RSS profile", () => {
    expect(limitsFixture.limits).toEqual({
      max_safe_integer: limits.MAX_SAFE_INTEGER,
      max_record_bytes: limits.MAX_RECORD_BYTES,
      max_string_bytes: limits.MAX_STRING_BYTES,
      max_message_bytes: limits.MAX_MESSAGE_BYTES,
      max_name_bytes: limits.MAX_NAME_BYTES,
      max_id_bytes: limits.MAX_ID_BYTES,
      max_arguments: limits.MAX_ARGUMENTS,
      max_argument_list_items: limits.MAX_ARGUMENT_LIST_ITEMS,
      max_argument_object_fields: limits.MAX_ARGUMENT_OBJECT_FIELDS,
      max_argument_depth: limits.MAX_ARGUMENT_DEPTH,
      max_batch_records: limits.MAX_BATCH_RECORDS,
      max_batch_bytes: limits.MAX_BATCH_BYTES,
      max_filter_values: limits.MAX_FILTER_VALUES,
      default_page_records: limits.DEFAULT_PAGE_RECORDS,
      max_page_records: limits.MAX_PAGE_RECORDS,
      max_tail_frame_records: limits.MAX_TAIL_FRAME_RECORDS,
      max_export_records: limits.MAX_EXPORT_RECORDS,
      max_export_bytes: limits.MAX_EXPORT_BYTES,
      max_cardinality_entries: limits.MAX_CARDINALITY_ENTRIES,
      max_versions_present: limits.MAX_VERSIONS_PRESENT,
      max_health_producers: limits.MAX_HEALTH_PRODUCERS,
      collector_total_rss_limit_bytes: limits.COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
      retained_record_arena_limit_bytes: limits.RETAINED_RECORD_ARENA_LIMIT_BYTES,
    });
    expect(limitsFixture.supported_previous_producer_minor_window).toBe(
      limits.SUPPORTED_PREVIOUS_PRODUCER_MINOR_WINDOW,
    );
    expect(parseRssMeasurementProfileV1(rssProfileFixture)).toEqual(rssProfileFixture);
    expect(limits.RETAINED_RECORD_ARENA_LIMIT_BYTES).toBeLessThan(
      limits.COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
    );
  });

  it("enforces representative exact byte and cardinality boundaries", () => {
    const idAtLimit = cloneRecord(recordsFixture.records[0]);
    idAtLimit.operation_id = "a".repeat(limits.MAX_ID_BYTES);
    expect(parseProducerRecordV1(idAtLimit).operation_id).toHaveLength(limits.MAX_ID_BYTES);
    idAtLimit.operation_id = "a".repeat(limits.MAX_ID_BYTES + 1);
    expect(rejectionReason(() => parseProducerRecordV1(idAtLimit))).toBe("limit_exceeded");

    const padded = cloneRecord(recordsFixture.records[0]);
    padded.future_padding = "";
    const recordOverhead = JSON.stringify(padded).length;
    padded.future_padding = "x".repeat(limits.MAX_RECORD_BYTES - recordOverhead);
    expect(JSON.stringify(padded)).toHaveLength(limits.MAX_RECORD_BYTES);
    expect(() => parseProducerRecordV1(padded)).not.toThrow();
    const atLimitRecord = cloneRecord(padded);
    padded.future_padding = `${padded.future_padding as string}x`;
    expect(rejectionReason(() => parseProducerRecordV1(padded))).toBe("record_too_large");

    const page = cloneRecord(apiFixture.records_page);
    const pageRecords = page.records as Record<string, unknown>[];
    pageRecords[0].record = atLimitRecord;
    expect(() => parseRecordsPageV1(page)).not.toThrow();
    pageRecords[0].record = padded;
    expect(rejectionReason(() => parseRecordsPageV1(page))).toBe("record_too_large");

    const batch: Record<string, unknown> = {
      schema_version: limits.CURRENT_SCHEMA_VERSION,
      records: [recordsFixture.records[0]],
      future_padding: "",
    };
    const batchOverhead = JSON.stringify(batch).length;
    batch.future_padding = "x".repeat(limits.MAX_BATCH_BYTES - batchOverhead);
    expect(JSON.stringify(batch)).toHaveLength(limits.MAX_BATCH_BYTES);
    expect(() => parseIngestBatchV1(batch)).not.toThrow();
    batch.future_padding = `${batch.future_padding as string}x`;
    expect(rejectionReason(() => parseIngestBatchV1(batch))).toBe("batch_too_large");

    const health = JSON.parse(JSON.stringify(apiFixture.health)) as Record<string, unknown>;
    health.cardinality_counts = Object.fromEntries(
      Array.from({ length: limits.MAX_CARDINALITY_ENTRIES }, (_, index) => [
        `key.${index}`,
        index,
      ]),
    );
    expect(() => parseHealthResponseV1(health)).not.toThrow();
    (health.cardinality_counts as Record<string, number>)[
      `key.${limits.MAX_CARDINALITY_ENTRIES}`
    ] = 1;
    expect(rejectionReason(() => parseHealthResponseV1(health))).toBe("limit_exceeded");
  });

  it("rejects lone Unicode surrogates as an invalid shape", () => {
    // Language-local by design: serde_json rejects a lone-surrogate JSON
    // escape while parsing, before Rust can consume a shared fixture.
    for (const value of ["\ud800", "\udc00"]) {
      const record = cloneRecord(recordsFixture.records[0]);
      record.release = value;
      expect(rejectionReason(() => parseProducerRecordV1(record))).toBe("invalid_shape");
    }

    const paired = cloneRecord(recordsFixture.records[0]);
    paired.release = "\ud83d\ude00";
    expect(parseProducerRecordV1(paired).release).toBe("\ud83d\ude00");
  });
});

function rejectionReason(callback: () => unknown): RejectionReasonV1 {
  try {
    callback();
  } catch (error) {
    if (error instanceof DiagnosticsContractErrorV1) {
      return error.reason;
    }
    throw error;
  }
  throw new Error("expected diagnostics contract rejection");
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
