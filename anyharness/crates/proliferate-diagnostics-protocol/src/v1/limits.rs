use super::types::SchemaVersionV1;

pub const CURRENT_SCHEMA_VERSION: SchemaVersionV1 = SchemaVersionV1 { major: 1, minor: 1 };
pub const MIN_SUPPORTED_PRODUCER_MINOR: u16 = 0;
pub const SUPPORTED_PREVIOUS_PRODUCER_MINOR_WINDOW: u16 = 1;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const MAX_RECORD_BYTES: usize = 65_536;
pub const MAX_STRING_BYTES: usize = 4_096;
pub const MAX_MESSAGE_BYTES: usize = 16_384;
pub const MAX_NAME_BYTES: usize = 128;
pub const MAX_ID_BYTES: usize = 128;
pub const MAX_ARGUMENTS: usize = 32;
pub const MAX_ARGUMENT_LIST_ITEMS: usize = 32;
pub const MAX_ARGUMENT_OBJECT_FIELDS: usize = 32;
pub const MAX_ARGUMENT_DEPTH: usize = 4;
pub const MAX_BATCH_RECORDS: usize = 128;
pub const MAX_BATCH_BYTES: usize = 1_048_576;
pub const MAX_FILTER_VALUES: usize = 32;
pub const DEFAULT_PAGE_RECORDS: u16 = 100;
pub const MAX_PAGE_RECORDS: u16 = 500;
pub const MAX_TAIL_FRAME_RECORDS: usize = 128;
pub const MAX_EXPORT_RECORDS: u32 = 10_000;
pub const MAX_EXPORT_BYTES: u64 = 33_554_432;
pub const MAX_CARDINALITY_ENTRIES: usize = 256;
pub const MAX_VERSIONS_PRESENT: usize = 16;
pub const MAX_HEALTH_PRODUCERS: usize = 64;

pub const COLLECTOR_TOTAL_RSS_LIMIT_BYTES: u64 = 52_428_800;
pub const RETAINED_RECORD_ARENA_LIMIT_BYTES: u64 = 33_554_432;
