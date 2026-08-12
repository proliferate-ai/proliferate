//! Closed enums of the schema-3 consented support snapshot.
//!
//! Every enum here is a closed set pinned by the frozen PR 6 specification.
//! Serialized literals are snake_case; variant declaration order is the
//! canonical serialization order for fixed-cardinality count maps.

use serde::{Deserialize, Serialize};

/// Evidence source attribution for omissions and truncations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportEvidenceSourceV1 {
    Collector,
    Renderer,
    Tauri,
    Anyharness,
    DesktopWorker,
    SessionLedger,
    Package,
}

/// Closed reasons a piece of evidence is omitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportOmissionReasonV1 {
    CollectorUnavailable,
    CollectorExportInterrupted,
    CollectorExportInvalid,
    CollectorLimitUncertain,
    ProducerStatusUnavailable,
    ChildMissing,
    SourceMissing,
    SourceUnreadable,
    SourceUnsafeMetadata,
    SourceInvalid,
    SourceCap,
    NoSelectedBundledLocalWorkspace,
    SessionUnavailable,
    SessionTimeout,
    SessionInvalid,
    SessionWindowLimitUncertain,
    LiveConfigNotCollected,
    RecordLimit,
    ByteLimit,
    PackageCap,
}

/// Closed reasons a piece of evidence is truncated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportTruncationReasonV1 {
    SourceTail,
    FieldBytes,
    ContainerItems,
    SessionEvents,
    RawNotifications,
    ComponentBytes,
    PackageBytes,
}

/// Closed secret classes counted by the scrubber. Declaration order is the
/// serialization order of `manifest.scrubbedByClass`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportSecretClassV1 {
    Authorization,
    Cookie,
    AccessToken,
    RefreshToken,
    IdentityToken,
    ApiKey,
    ClientSecret,
    Password,
    PrivateKey,
    CredentialContainer,
    EnvironmentSecret,
    SignedUrl,
    ProviderCredential,
    OpaqueCredential,
    UrlUserinfo,
}

/// Closed producer loss reasons. Declaration order is the serialization
/// order of `droppedByReason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportLossReasonV1 {
    QueueRecords,
    QueueBytes,
    ProtectedEviction,
    Pressure,
    GenerationChanged,
    TransportTimeout,
    TransportFailure,
    ReceiptInvalid,
    ReceiptRejected,
    FallbackOverflow,
    FallbackWriteFailed,
    ShutdownTimeout,
    FilterInvalid,
    SequenceExhausted,
}

/// Closed desktop diagnostics supervisor failure classifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopDiagnosticsFailureClassV1 {
    UnsupportedTarget,
    BinaryMissing,
    BinaryInvalid,
    SpawnFailed,
    EndpointUnavailable,
    ReadinessTimeout,
    AuthenticationFailed,
    SchemaIncompatible,
    BootIdMismatch,
    HealthUnavailable,
    ChildExited,
    ChildInspectionFailed,
    RestartExhausted,
    ShutdownArmed,
    ShutdownTimeout,
    ShutdownFailed,
}

/// Closed PR 5 fallback-routing reasons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportPr5FallbackReasonV1 {
    CollectorUnavailable,
    GenerationChanged,
    TransportCooldown,
    DeliveryUnknown,
    FinalTeardown,
}

/// Collector coverage capture status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportCollectorStatusV1 {
    Complete,
    LimitUncertain,
    Unavailable,
    Interrupted,
    Invalid,
}

/// Collector coverage completeness claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportCollectorCompletenessV1 {
    Complete,
    LimitUncertain,
    Unknown,
}

/// Pinned collector selection literal: only the oldest matching retained
/// prefix is ever claimed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportCoverageSelectionV1 {
    OldestMatchingRetainedPrefix,
}

/// Supervisor launch kind while starting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportLaunchKindV1 {
    Initial,
    AutomaticRestart,
}

/// Child producer components that report exact PR 5 snapshots.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportChildComponentV1 {
    Anyharness,
    DesktopWorker,
}

/// Pinned single-literal `state: "omitted"` marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportOmittedStateV1 {
    Omitted,
}

/// Pinned single-literal producer-status omission reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportProducerStatusUnavailableV1 {
    ProducerStatusUnavailable,
}

/// Closed reasons a child producer snapshot is omitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportChildOmissionReasonV1 {
    ProducerStatusUnavailable,
    ChildMissing,
    SourceInvalid,
}

/// Component attribution of a structured fallback record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportFallbackRecordComponentV1 {
    DesktopRenderer,
    DesktopTauri,
    Anyharness,
    DesktopWorker,
}

/// Delivery disposition of a structured fallback record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportFallbackDispositionV1 {
    NotCollectorAccepted,
    DeliveryUnknown,
}

/// Pinned single-literal opaque fallback component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportUnknownDesktopNativeV1 {
    UnknownDesktopNative,
}

/// Closed legacy text evidence sources. The two Worker compatibility
/// namespaces are distinct fixed values, never a caller-controlled namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportLegacySourceKindV1 {
    RendererDiagnostics,
    AnyharnessPrimary,
    WorkerPrimaryV2,
    WorkerPrimaryV1,
}

/// Session endpoint collection state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportEndpointStateV1 {
    Included,
    Omitted,
    LimitUncertain,
}

/// Pinned single-literal live-config endpoint state: never collected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportLiveConfigStateV1 {
    NotCollected,
}

/// Consented session scope selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportSessionSelectionV1 {
    ActiveSession,
    RecentActivity,
}

/// Closed reasons the session collection is omitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportSessionOmissionReasonV1 {
    NoSelectedBundledLocalWorkspace,
    SessionUnavailable,
    SessionTimeout,
    SessionInvalid,
}

/// Closed source identities in `manifest.sources`. At most one entry per
/// value, which is what bounds the collection at nine entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportSourceManifestSourceV1 {
    Collector,
    DesktopNativeFallback,
    AnyharnessFallback,
    DesktopWorkerFallback,
    RendererLegacy,
    AnyharnessLegacy,
    WorkerLegacyV2,
    WorkerLegacyV1,
    SessionLedger,
}

/// Per-source manifest collection state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportSourceStateV1 {
    Included,
    Missing,
    Unreadable,
    Unsafe,
    Invalid,
    Omitted,
}

/// Pinned single-literal consent disclosure version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportConsentDisclosureVersionV1 {
    DesktopSupportSnapshotCustomerContentV1,
}
