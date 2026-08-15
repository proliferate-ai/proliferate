//! Fixed bounds for the schema-3 consented support snapshot.
//!
//! Every value is pinned by the frozen PR 6 specification. These are not
//! tunables: the golden fixture and the serialized `manifest.limits` object
//! both assert the exact numbers, so changing one here without a spec change
//! is a contract break.

/// Largest integer representable exactly in a JavaScript number (2^53 - 1).
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Maximum UTF-8 byte length for IDs, names, and timestamps.
pub const MAX_ID_BYTES: usize = 128;

/// Maximum UTF-8 byte length for generic (non-content) strings.
pub const GENERIC_STRING_BYTES: usize = 4_096;

/// Maximum UTF-8 byte length for customer-content strings.
pub const CONTENT_STRING_BYTES: usize = 16_384;

/// Maximum items per array or keys per object in a projected JSON value.
pub const CONTAINER_ITEMS: usize = 256;

/// Maximum nesting depth of a projected JSON value.
pub const NESTING_DEPTH: usize = 16;

/// Maximum serialized bytes of the complete snapshot package.
pub const PACKAGE_BYTES: u64 = 26_214_400;

/// Maximum serialized bytes of the mandatory manifest skeleton.
pub const MANIFEST_BYTES: u64 = 262_144;

/// Aggregate read budget across all fallback/legacy files.
pub const ALL_FILES_READ_BYTES: u64 = 10_485_760;

/// Per-component read budget for fallback/legacy files.
pub const COMPONENT_FILES_READ_BYTES: u64 = 2_097_152;

/// Included-byte cap for desktop-native fallback evidence.
pub const DESKTOP_NATIVE_FALLBACK_BYTES: u64 = 1_048_576;

/// Included-byte cap for AnyHarness fallback evidence.
pub const ANYHARNESS_FALLBACK_BYTES: u64 = 2_097_152;

/// Included-byte cap for desktop worker fallback evidence.
pub const DESKTOP_WORKER_FALLBACK_BYTES: u64 = 2_097_152;

/// Maximum bytes of a single source line.
pub const SOURCE_LINE_BYTES: u64 = 262_144;

/// Collector export request record limit.
pub const COLLECTOR_RECORDS: u64 = 10_000;

/// Collector export request byte limit.
pub const COLLECTOR_BYTES: u64 = 16_777_216;

/// Maximum sessions in the session ledger.
pub const SESSIONS: u64 = 3;

/// Session list response byte cap.
pub const SESSION_LIST_RESPONSE_BYTES: u64 = 1_048_576;

/// Normalized events per session cap.
pub const EVENTS_PER_SESSION: u64 = 200;

/// Event response byte cap.
pub const EVENT_RESPONSE_BYTES: u64 = 4_194_304;

/// Raw notifications per session cap.
pub const RAW_NOTIFICATIONS_PER_SESSION: u64 = 100;

/// Raw notification response byte cap.
pub const RAW_NOTIFICATION_RESPONSE_BYTES: u64 = 2_097_152;

/// Total session evidence byte cap.
pub const SESSION_EVIDENCE_BYTES: u64 = 8_388_608;

/// Per-session byte cap.
pub const SESSION_BYTES: u64 = 4_194_304;

/// Maximum entries in `manifest.sources`.
pub const MAX_SOURCE_ENTRIES: usize = 9;

/// Maximum entries in `manifest.gaps`.
pub const MAX_GAP_ENTRIES: usize = 128;

/// Maximum entries in `manifest.omissions`.
pub const MAX_OMISSION_ENTRIES: usize = 64;

/// Maximum entries in `manifest.truncations`.
pub const MAX_TRUNCATION_ENTRIES: usize = 64;

/// Exact number of degradation tier counters.
pub const DEGRADATION_TIER_COUNT: usize = 8;

/// Pinned collector coverage request record limit literal.
pub const COVERAGE_REQUEST_RECORD_LIMIT: u64 = COLLECTOR_RECORDS;

/// Pinned collector coverage request byte limit literal.
pub const COVERAGE_REQUEST_BYTE_LIMIT: u64 = COLLECTOR_BYTES;

/// Pinned manifest schema version literal.
pub const MANIFEST_SCHEMA_VERSION: u64 = 1;

/// Pinned snapshot schema version literal.
pub const SNAPSHOT_SCHEMA_VERSION: u64 = 3;

/// Pinned degradation policy version literal.
pub const DEGRADATION_POLICY_VERSION: u64 = 1;

/// Pinned collector schema major accepted in the `ready` supervisor state.
pub const COLLECTOR_SCHEMA_MAJOR: u16 = 1;
