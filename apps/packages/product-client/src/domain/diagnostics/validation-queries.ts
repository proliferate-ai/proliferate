import type { RecordsPageV1, RecordsQueryV1, TailFrameV1 } from "./contract";
import {
  MAX_CARDINALITY_ENTRIES,
  MAX_PAGE_RECORDS,
  MAX_TAIL_FRAME_RECORDS,
  MAX_VERSIONS_PRESENT,
} from "./limits";
import { parseCollectorAcceptedRecordV1 } from "./validation-records";
import {
  canonicalClone,
  fail,
  optionalNonnegativeInteger,
  requireArray,
  requireNonnegativeInteger,
  requireObject,
  requirePositiveInteger,
} from "./validation-scalars";
import {
  parseFilters,
  parseGap,
  parseSchemaVersion,
  parseVersionCount,
} from "./validation-support";

export function parseRecordsQueryV1(input: unknown): RecordsQueryV1 {
  const raw = requireObject(input);
  const limit = requirePositiveInteger(raw.limit);
  if (limit > MAX_PAGE_RECORDS) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    after_cursor: optionalNonnegativeInteger(raw.after_cursor),
    limit,
    filters: parseFilters(raw.filters),
  });
}

export function parseRecordsPageV1(input: unknown): RecordsPageV1 {
  const raw = requireObject(input);
  const records = requireArray(raw.records);
  const gaps = requireArray(raw.gaps);
  const versions = requireArray(raw.versions_present);
  if (
    records.length > MAX_PAGE_RECORDS ||
    gaps.length > MAX_CARDINALITY_ENTRIES ||
    versions.length > MAX_VERSIONS_PRESENT
  ) {
    fail("limit_exceeded");
  }
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    records: records.map(parseCollectorAcceptedRecordV1),
    next_cursor: optionalNonnegativeInteger(raw.next_cursor),
    gaps: gaps.map(parseGap),
    versions_present: versions.map(parseVersionCount),
  });
}

export function parseTailFrameV1(input: unknown): TailFrameV1 {
  const raw = requireObject(input);
  if (raw.frame === "records") {
    const records = requireArray(raw.records);
    if (records.length > MAX_TAIL_FRAME_RECORDS) {
      fail("limit_exceeded");
    }
    return {
      frame: "records",
      records: records.map(parseCollectorAcceptedRecordV1),
      cursor: requireNonnegativeInteger(raw.cursor),
    };
  }
  if (raw.frame === "lag") {
    return {
      frame: "lag",
      dropped_frames: requireNonnegativeInteger(raw.dropped_frames),
      resume_after_cursor: requireNonnegativeInteger(raw.resume_after_cursor),
    };
  }
  if (raw.frame === "gap") {
    return { frame: "gap", gap: parseGap(raw.gap) };
  }
  fail("invalid_shape");
}
