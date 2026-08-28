use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchModel {
    pub id: String,
    pub observed_name: Option<String>,
    pub observed_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchControlValue {
    pub value: String,
    pub observed_label: Option<String>,
    pub observed_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchControl {
    pub id: String,
    pub observed_label: Option<String>,
    pub observed_description: Option<String>,
    pub values: Vec<HarnessLaunchControlValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchModelControls {
    pub model_id: String,
    pub controls: Vec<HarnessLaunchControl>,
    pub default_control_values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchDefaults {
    pub model_id: Option<String>,
    #[serde(default)]
    pub control_values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchOptions {
    pub models: Vec<HarnessLaunchModel>,
    pub controls: Vec<HarnessLaunchControl>,
    pub defaults: HarnessLaunchDefaults,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_controls: Vec<HarnessLaunchModelControls>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchSelection {
    pub model_id: Option<String>,
    pub control_values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeState {
    Probing,
    Succeeded,
    Failed,
}

impl ProbeState {
    #[allow(dead_code)] // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Probing => "probing",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }

    pub(super) fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "probing" => Ok(Self::Probing),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("invalid launch-option probe state: {other}"),
                )),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessLaunchOptionStateRow {
    pub harness_kind: String,
    pub basis_revision: String,
    pub revision: i64,
    pub options: Option<HarnessLaunchOptions>,
    pub observed_at: Option<String>,
    pub probe_state: ProbeState,
    pub probe_attempted_at: String,
    pub probe_failure_code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessLaunchOptionsState {
    Detecting,
    Refreshing,
    Observed,
    ObservedEmpty,
    LastGoodAfterFailure,
    FailedWithoutObservation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
}
