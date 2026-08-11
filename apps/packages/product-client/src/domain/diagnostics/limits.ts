import type { SchemaVersionV1 } from "./contract";

export const CURRENT_SCHEMA_VERSION: SchemaVersionV1 = { major: 1, minor: 1 };
export const MIN_SUPPORTED_PRODUCER_MINOR = 0;
export const SUPPORTED_PREVIOUS_PRODUCER_MINOR_WINDOW = 1;
export const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

export const MAX_RECORD_BYTES = 65_536;
export const MAX_STRING_BYTES = 4_096;
export const MAX_MESSAGE_BYTES = 16_384;
export const MAX_NAME_BYTES = 128;
export const MAX_ID_BYTES = 128;
export const MAX_ARGUMENTS = 32;
export const MAX_ARGUMENT_LIST_ITEMS = 32;
export const MAX_ARGUMENT_OBJECT_FIELDS = 32;
export const MAX_ARGUMENT_DEPTH = 4;
export const MAX_BATCH_RECORDS = 128;
export const MAX_BATCH_BYTES = 1_048_576;
export const MAX_FILTER_VALUES = 32;
export const DEFAULT_PAGE_RECORDS = 100;
export const MAX_PAGE_RECORDS = 500;
export const MAX_TAIL_FRAME_RECORDS = 128;
export const MAX_EXPORT_RECORDS = 10_000;
export const MAX_EXPORT_BYTES = 33_554_432;
export const MAX_CARDINALITY_ENTRIES = 256;
export const MAX_VERSIONS_PRESENT = 16;
export const MAX_HEALTH_PRODUCERS = 64;

export const COLLECTOR_TOTAL_RSS_LIMIT_BYTES = 52_428_800;
export const RETAINED_RECORD_ARENA_LIMIT_BYTES = 33_554_432;
