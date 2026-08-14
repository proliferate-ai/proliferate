use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProblemDetails {
    #[serde(rename = "type")]
    pub type_url: String,
    pub title: String,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// The one structured extension point typed error bodies ride. Before it
    /// existed the only place to put a machine-readable payload was `detail`,
    /// a human sentence — so a client that needed the offending lock `file` or
    /// the unarchive scenario's `strategies` list had to parse prose. Codes
    /// that carry a payload document its shape next to their status mapping
    /// (`api/http/workspaces_lifecycle_errors.rs`); every other code leaves
    /// this absent, and the field is skip-serializing so no existing body
    /// changes shape.
    ///
    /// Declared `Object` because the payload is per-code and deliberately
    /// unconstrained. utoipa emits that as a bare `{"type":"object"}`, which
    /// `openapi-typescript` narrows to `Record<string, never>`; the SDK widens
    /// this one field back to `unknown` in `src/types/runtime.ts` rather than
    /// carrying a generated type that claims the payload has no keys.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Object)]
    pub extra: Option<serde_json::Value>,
}
