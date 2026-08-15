import type {
  ExportManifestV1,
  ExportPurposeV1,
  ExportRequestV1,
  ExportStreamFrameV1,
} from "./contract";
import {
  MAX_CARDINALITY_ENTRIES,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_RECORDS,
  MAX_VERSIONS_PRESENT,
} from "./limits";
import { parseHealthResponseV1 } from "./validation-health";
import { parseCollectorAcceptedRecordV1 } from "./validation-records";
import {
  canonicalClone,
  fail,
  optionalId,
  optionalNonnegativeInteger,
  requireArray,
  requireBoolean,
  requireEnum,
  requireId,
  requireNonnegativeInteger,
  requireObject,
  requirePositiveInteger,
  requireTimestamp,
} from "./validation-scalars";
import {
  parseFilters,
  parseGap,
  parseSchemaVersion,
  parseVersionCount,
} from "./validation-support";
import { REDACTION } from "./validation-vocabulary";

export function parseExportRequestV1(input: unknown): ExportRequestV1 {
  const raw = requireObject(input);
  const purpose = requireEnum(
    raw.purpose,
    new Set<ExportPurposeV1>(["support", "internal_dogfood"]),
  );
  const authorization = optionalId(raw.support_authorization_id);
  if (
    (purpose === "support" && authorization === undefined) ||
    (purpose === "internal_dogfood" && authorization !== undefined)
  ) {
    fail("invalid_shape");
  }
  const recordLimit = requirePositiveInteger(raw.record_limit);
  const byteLimit = requirePositiveInteger(raw.byte_limit);
  if (recordLimit > MAX_EXPORT_RECORDS || byteLimit > MAX_EXPORT_BYTES) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    purpose,
    support_authorization_id: authorization,
    filters: parseFilters(raw.filters),
    record_limit: recordLimit,
    byte_limit: byteLimit,
    include_health: requireBoolean(raw.include_health),
  });
}

export function parseExportManifestV1(input: unknown): ExportManifestV1 {
  const raw = requireObject(input);
  const recordCount = requireNonnegativeInteger(raw.record_count);
  const byteCount = requireNonnegativeInteger(raw.byte_count);
  const gaps = requireArray(raw.gaps);
  const versions = requireArray(raw.versions_present);
  if (
    recordCount > MAX_EXPORT_RECORDS ||
    byteCount > MAX_EXPORT_BYTES ||
    gaps.length > MAX_CARDINALITY_ENTRIES ||
    versions.length > MAX_VERSIONS_PRESENT
  ) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    snapshot_id: requireId(raw.snapshot_id),
    generated_at: requireTimestamp(raw.generated_at),
    record_count: recordCount,
    byte_count: byteCount,
    cursor_start: optionalNonnegativeInteger(raw.cursor_start),
    cursor_end: optionalNonnegativeInteger(raw.cursor_end),
    gaps: gaps.map(parseGap),
    versions_present: versions.map(parseVersionCount),
    filters: parseFilters(raw.filters),
    redaction: requireEnum(raw.redaction, REDACTION),
    includes_health: requireBoolean(raw.includes_health),
  });
}

export function parseExportStreamFrameV1(input: unknown): ExportStreamFrameV1 {
  const raw = requireObject(input);
  switch (raw.frame) {
    case "manifest":
      return { frame: "manifest", manifest: parseExportManifestV1(raw.manifest) };
    case "record":
      return { frame: "record", record: parseCollectorAcceptedRecordV1(raw.record) };
    case "gap":
      return { frame: "gap", gap: parseGap(raw.gap) };
    case "health":
      return { frame: "health", health: parseHealthResponseV1(raw.health) };
    case "end":
      return {
        frame: "end",
        records: requireNonnegativeInteger(raw.records),
        bytes: requireNonnegativeInteger(raw.bytes),
      };
    default:
      fail("invalid_shape");
  }
}
