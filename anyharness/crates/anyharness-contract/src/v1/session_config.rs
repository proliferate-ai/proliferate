use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A raw selectable value exposed by an active ACP session configuration option.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawSessionConfigValue {
    /// Stable ACP value identifier used when setting this option.
    pub value: String,
    /// Human-readable label shown to users.
    pub name: String,
    /// Optional description supplied by the agent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A raw ACP session configuration option as exposed by the active session.
///
/// This is the transport-fidelity layer. It should match the live ACP state as
/// closely as possible without applying product-specific interpretation.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawSessionConfigOption {
    /// Stable ACP configuration option identifier.
    pub id: String,
    /// Human-readable label shown to users.
    pub name: String,
    /// Optional description supplied by the agent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional ACP semantic category such as `model`, `mode`, or `thought_level`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Input control type for this option.
    #[serde(rename = "type")]
    pub option_type: SessionConfigOptionType,
    /// Currently selected raw value identifier.
    pub current_value: String,
    /// Selectable raw values currently exposed by the agent.
    pub options: Vec<RawSessionConfigValue>,
}

/// Supported ACP session configuration input types.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionConfigOptionType {
    /// A single-value selector.
    Select,
}

/// A normalized selectable value for product-facing live session controls.
///
/// This intentionally remains distinct from `RawSessionConfigValue` even though
/// the current shapes are similar. The normalized layer is expected to evolve
/// independently from the raw ACP wire shape as product-facing control metadata
/// grows over time.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSessionControlValue {
    /// Stable raw value identifier to send back when mutating this control.
    pub value: String,
    /// Human-readable label shown to users.
    pub label: String,
    /// Optional user-facing description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A product-normalized live session control derived from raw ACP config options.
///
/// This is the product semantics layer used by clients to render consistent
/// controls such as model, mode, reasoning, effort, and fast mode across
/// different harnesses.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSessionControl {
    /// Product-level semantic key such as `model`, `mode`, `reasoning`, or `effort`.
    pub key: String,
    /// Identifier sent back when mutating this control.
    ///
    /// This is usually the raw ACP config option identifier, but compatibility
    /// controls may use a reserved synthetic identifier such as `mode` or
    /// `model`.
    pub raw_config_id: String,
    /// Human-readable control label shown to users.
    pub label: String,
    /// Currently selected raw value identifier, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_value: Option<String>,
    /// Whether the control currently exposes more than one selectable value.
    pub settable: bool,
    /// Selectable values currently available for this control.
    pub values: Vec<NormalizedSessionControlValue>,
}

/// The normalized live session controls currently recognized by AnyHarness.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSessionControls {
    /// Normalized model selector, if exposed by the active session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<NormalizedSessionControl>,
    /// Normalized collaboration-mode selector, if exposed by the active session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collaboration_mode: Option<NormalizedSessionControl>,
    /// Normalized mode selector, if exposed by the active session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<NormalizedSessionControl>,
    /// Normalized reasoning on/off style control, if exposed by the active session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<NormalizedSessionControl>,
    /// Normalized reasoning effort/intensity selector, if exposed by the active session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<NormalizedSessionControl>,
    /// Normalized fast-mode selector, if exposed by the active session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fast_mode: Option<NormalizedSessionControl>,
    /// Additional live controls not mapped into the standard normalized set.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extras: Vec<NormalizedSessionControl>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptCapabilities {
    #[serde(default)]
    pub image: bool,
    #[serde(default)]
    pub audio: bool,
    #[serde(default)]
    pub embedded_context: bool,
}

/// The current live session configuration snapshot persisted by AnyHarness.
///
/// This contains both the exact raw ACP config state and AnyHarness's
/// normalized control view for convenient client rendering.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionLiveConfigSnapshot {
    /// Exact raw ACP config options currently exposed by the active session.
    pub raw_config_options: Vec<RawSessionConfigOption>,
    /// Product-normalized view of the current live controls.
    pub normalized_controls: NormalizedSessionControls,
    /// Content block capabilities advertised by the active ACP agent.
    #[serde(default)]
    pub prompt_capabilities: PromptCapabilities,
    /// Session event sequence number from which this snapshot was produced.
    pub source_seq: i64,
    /// Timestamp when this snapshot was last updated.
    pub updated_at: String,
}

/// Response payload for fetching the current live session config snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionLiveConfigResponse {
    /// Current live session config snapshot, if the runtime has observed one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_config: Option<SessionLiveConfigSnapshot>,
}

/// Request payload for changing a single live session config option.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionConfigOptionRequest {
    /// Raw ACP config option identifier to mutate, or a reserved compatibility
    /// identifier such as `mode` or `model`.
    pub config_id: String,
    /// Raw ACP value identifier to apply.
    pub value: String,
}

/// Whether a live config change was applied immediately or queued for later.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigApplyState {
    /// The change was applied immediately to the active session.
    Applied,
    /// The change was accepted and queued to apply when the session next becomes idle.
    Queued,
}

/// Response payload for changing a single live session config option.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionConfigOptionResponse {
    /// Updated session summary after accepting the change.
    pub session: super::Session,
    /// Latest known live config snapshot after the change was applied or queued.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_config: Option<SessionLiveConfigSnapshot>,
    /// Whether the change was applied immediately or queued for later application.
    pub apply_state: ConfigApplyState,
}
