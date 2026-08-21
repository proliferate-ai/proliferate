//! Target-observed harness launch options — the wire half of what a harness
//! itself reported it can be launched with.
//!
//! Split from `agents` because this family is one feature's contract and grows
//! with it: models, controls, their defaults, the observation state machine, and
//! the response that carries all of it plus what the serving runtime can do.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::agents::{AgentAuthProbePhase, AgentReadinessState};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchModel {
    pub id: String,
    pub observed_name: Option<String>,
    pub observed_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchControlValue {
    pub value: String,
    pub observed_label: Option<String>,
    pub observed_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchControl {
    pub id: String,
    pub observed_label: Option<String>,
    pub observed_description: Option<String>,
    pub values: Vec<HarnessLaunchControlValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchModelControls {
    pub model_id: String,
    pub controls: Vec<HarnessLaunchControl>,
    pub default_control_values: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchDefaults {
    pub model_id: Option<String>,
    #[serde(default)]
    pub control_values: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchOptions {
    pub models: Vec<HarnessLaunchModel>,
    pub controls: Vec<HarnessLaunchControl>,
    pub defaults: HarnessLaunchDefaults,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_controls: Vec<HarnessLaunchModelControls>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HarnessLaunchOptionsState {
    Detecting,
    Refreshing,
    Observed,
    ObservedEmpty,
    LastGoodAfterFailure,
    FailedWithoutObservation,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchOptionsResponse {
    pub harness_kind: String,
    pub basis_revision: String,
    pub revision: i64,
    pub state: HarnessLaunchOptionsState,
    pub options: Option<HarnessLaunchOptions>,
    pub observed_at: Option<String>,
    pub probe_attempted_at: String,
    pub probe_failure_code: Option<String>,
    pub readiness: AgentReadinessState,
    /// The launch-probe scheduler's live phase for this harness — the same
    /// lifecycle as [`AgentAuthProbeLifecycle::phase`]. Absent when the runtime
    /// serving this response cannot know it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe_phase: Option<AgentAuthProbePhase>,
    /// Does the runtime serving this response own the probe engine for its runtime
    /// home, and so can a manual refresh dispatched here run at all?
    ///
    /// A runtime that does not answers the refresh route with 409
    /// `PROBE_ENGINE_NOT_OWNER`, and ownership appears nowhere else on any wire —
    /// so a surface inferring it from "is this runtime local?" renders a Refresh
    /// control whose only possible outcome is an error toast. Install state is a
    /// separate precondition and is already reported by `readiness`; a surface
    /// gating a Refresh control must respect both.
    pub can_manually_refresh: bool,
}
