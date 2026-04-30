use anyharness_contract::v1;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginKind {
    Human,
    Cowork,
    Api,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginEntrypoint {
    Desktop,
    Cloud,
    LocalRuntime,
    Cowork,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginContext {
    pub kind: OriginKind,
    pub entrypoint: OriginEntrypoint,
}

impl OriginContext {
    pub fn human_desktop() -> Self {
        Self {
            kind: OriginKind::Human,
            entrypoint: OriginEntrypoint::Desktop,
        }
    }

    pub fn human_cloud() -> Self {
        Self {
            kind: OriginKind::Human,
            entrypoint: OriginEntrypoint::Cloud,
        }
    }

    pub fn cowork() -> Self {
        Self {
            kind: OriginKind::Cowork,
            entrypoint: OriginEntrypoint::Cowork,
        }
    }

    pub fn api_local_runtime() -> Self {
        Self {
            kind: OriginKind::Api,
            entrypoint: OriginEntrypoint::LocalRuntime,
        }
    }

    pub fn system_local_runtime() -> Self {
        Self {
            kind: OriginKind::System,
            entrypoint: OriginEntrypoint::LocalRuntime,
        }
    }

    pub fn from_contract(origin: v1::OriginContext) -> Self {
        Self {
            kind: match origin.kind {
                v1::OriginKind::Human => OriginKind::Human,
                v1::OriginKind::Cowork => OriginKind::Cowork,
                v1::OriginKind::Api => OriginKind::Api,
                v1::OriginKind::System => OriginKind::System,
            },
            entrypoint: match origin.entrypoint {
                v1::OriginEntrypoint::Desktop => OriginEntrypoint::Desktop,
                v1::OriginEntrypoint::Cloud => OriginEntrypoint::Cloud,
                v1::OriginEntrypoint::LocalRuntime => OriginEntrypoint::LocalRuntime,
                v1::OriginEntrypoint::Cowork => OriginEntrypoint::Cowork,
            },
        }
    }

    pub fn to_contract(&self) -> v1::OriginContext {
        v1::OriginContext {
            kind: match self.kind {
                OriginKind::Human => v1::OriginKind::Human,
                OriginKind::Cowork => v1::OriginKind::Cowork,
                OriginKind::Api => v1::OriginKind::Api,
                OriginKind::System => v1::OriginKind::System,
            },
            entrypoint: match self.entrypoint {
                OriginEntrypoint::Desktop => v1::OriginEntrypoint::Desktop,
                OriginEntrypoint::Cloud => v1::OriginEntrypoint::Cloud,
                OriginEntrypoint::LocalRuntime => v1::OriginEntrypoint::LocalRuntime,
                OriginEntrypoint::Cowork => v1::OriginEntrypoint::Cowork,
            },
        }
    }
}

pub fn encode_origin_json(origin: &Option<OriginContext>) -> rusqlite::Result<Option<String>> {
    origin
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

pub fn decode_origin_json(
    table: &'static str,
    row_id: &str,
    origin_json: Option<String>,
) -> Option<OriginContext> {
    let value = origin_json.as_deref()?.trim();
    if value.is_empty() {
        return None;
    }
    match serde_json::from_str(value) {
        Ok(origin) => Some(origin),
        Err(error) => {
            tracing::warn!(
                table,
                row_id,
                error = %error,
                "invalid origin JSON; omitting advisory origin"
            );
            None
        }
    }
}
