use std::fmt;

use accept::accept_form;
use agent_client_protocol as acp;
use anyharness_contract::v1::{McpElicitationInteractionPayload, McpElicitationSubmittedField};
pub use ext_response::{
    claude_ext_response_from_outcome, standard_elicitation_response_from_outcome,
};
use normalize::{normalize_form, normalize_url};
use serde::Deserialize;
use serde_json::Value;
use url::Url;

mod accept;
mod ext_response;
mod normalize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMcpElicitationExtParams {
    pub server_name: String,
    pub message: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub requested_schema: Option<Value>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

impl fmt::Debug for ClaudeMcpElicitationExtParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClaudeMcpElicitationExtParams")
            .field("server_name", &self.server_name)
            .field("mode", &self.mode)
            .field("url_display", &self.url.as_deref().map(safe_url_display))
            .field("schema_present", &self.requested_schema.is_some())
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct NormalizedMcpElicitation {
    pub title: String,
    pub description: Option<String>,
    pub payload: McpElicitationInteractionPayload,
    pub pending: StoredMcpElicitation,
}

#[derive(Clone)]
pub struct StoredMcpElicitation {
    mode: StoredMcpElicitationMode,
}

impl fmt::Debug for StoredMcpElicitation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.mode {
            StoredMcpElicitationMode::Form { fields } => f
                .debug_struct("StoredMcpElicitation::Form")
                .field("field_count", &fields.len())
                .finish(),
            StoredMcpElicitationMode::Url { url, .. } => f
                .debug_struct("StoredMcpElicitation::Url")
                .field("has_url", &(!url.is_empty()))
                .finish(),
        }
    }
}

#[derive(Clone)]
pub(super) enum StoredMcpElicitationMode {
    Form { fields: Vec<StoredMcpField> },
    Url { url: String },
}

#[derive(Clone)]
pub(super) struct StoredMcpField {
    pub(super) field_id: String,
    pub(super) raw_name: String,
    pub(super) required: bool,
    pub(super) kind: StoredMcpFieldKind,
}

#[derive(Clone)]
pub(super) enum StoredMcpFieldKind {
    String {
        min_length: Option<u32>,
        max_length: Option<u32>,
    },
    Integer {
        minimum: Option<i64>,
        maximum: Option<i64>,
    },
    Number {
        minimum: Option<f64>,
        maximum: Option<f64>,
    },
    Boolean,
    SingleSelect {
        options: Vec<StoredMcpOption>,
    },
    MultiSelect {
        options: Vec<StoredMcpOption>,
        min_items: Option<u64>,
        max_items: Option<u64>,
    },
}

#[derive(Clone)]
pub(super) struct StoredMcpOption {
    pub(super) option_id: String,
    pub(super) raw_value: String,
}

#[derive(Clone, PartialEq)]
pub enum McpElicitationOutcome {
    Accepted {
        accepted_field_ids: Vec<String>,
        content: Option<Value>,
    },
    Declined,
    Cancelled,
    Dismissed,
}

impl fmt::Debug for McpElicitationOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Accepted {
                accepted_field_ids,
                content,
            } => f
                .debug_struct("Accepted")
                .field("accepted_field_ids", accepted_field_ids)
                .field("has_content", &content.is_some())
                .finish(),
            Self::Declined => f.write_str("Declined"),
            Self::Cancelled => f.write_str("Cancelled"),
            Self::Dismissed => f.write_str("Dismissed"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpElicitationValidationError {
    UnsupportedSchema,
    InvalidFieldId,
    DuplicateField,
    MissingRequiredField,
    InvalidValue,
    NotUrlElicitation,
}

pub fn normalize_standard_mcp_elicitation(
    request: acp::schema::CreateElicitationRequest,
) -> Result<NormalizedMcpElicitation, McpElicitationValidationError> {
    use acp::schema::ElicitationMode;

    let message = request.message;
    let server_name = "mcp".to_string();

    match request.mode {
        ElicitationMode::Form(form) => {
            let schema = serde_json::to_value(&form.requested_schema)
                .map_err(|_| McpElicitationValidationError::UnsupportedSchema)?;
            normalize_form(server_name, message, schema)
        }
        ElicitationMode::Url(url) => Ok(normalize_url(server_name, message, url.url)),
        _ => Err(McpElicitationValidationError::UnsupportedSchema),
    }
}

pub fn normalize_claude_mcp_elicitation(
    params: ClaudeMcpElicitationExtParams,
) -> Result<NormalizedMcpElicitation, McpElicitationValidationError> {
    let message = first_non_empty(&params.message)
        .unwrap_or_else(|| {
            params
                .title
                .as_deref()
                .and_then(first_non_empty)
                .unwrap_or("MCP elicitation requested")
        })
        .to_string();

    match params.mode.as_deref().unwrap_or("form") {
        "url" => {
            let url = params
                .url
                .filter(|url| !url.trim().is_empty())
                .ok_or(McpElicitationValidationError::InvalidValue)?;
            Ok(normalize_url(params.server_name, message, url))
        }
        "form" | "" => {
            let schema = params
                .requested_schema
                .ok_or(McpElicitationValidationError::UnsupportedSchema)?;
            normalize_form(params.server_name, message, schema)
        }
        _ => Err(McpElicitationValidationError::UnsupportedSchema),
    }
}

impl StoredMcpElicitation {
    pub fn accept(
        &self,
        submitted_fields: Vec<McpElicitationSubmittedField>,
    ) -> Result<McpElicitationOutcome, McpElicitationValidationError> {
        match &self.mode {
            StoredMcpElicitationMode::Form { fields } => accept_form(fields, submitted_fields),
            StoredMcpElicitationMode::Url { .. } => {
                if submitted_fields.is_empty() {
                    Ok(McpElicitationOutcome::Accepted {
                        accepted_field_ids: Vec::new(),
                        content: None,
                    })
                } else {
                    Err(McpElicitationValidationError::InvalidValue)
                }
            }
        }
    }

    pub fn reveal_url(&self) -> Result<String, McpElicitationValidationError> {
        match &self.mode {
            StoredMcpElicitationMode::Url { url } => Ok(url.clone()),
            StoredMcpElicitationMode::Form { .. } => {
                Err(McpElicitationValidationError::NotUrlElicitation)
            }
        }
    }
}

fn safe_url_display(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .host_str()
                .map(|host| format!("{}://{host}", parsed.scheme()))
        })
        .unwrap_or_else(|| "External link".to_string())
}

fn first_non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::{
        CreateElicitationRequest, ElicitationFormMode, ElicitationId, ElicitationSchema,
        ElicitationSessionScope, ElicitationUrlMode, EnumOption, StringPropertySchema,
    };
    use anyharness_contract::v1::McpElicitationSubmittedValue;
    use serde_json::json;

    fn standard_select_request() -> CreateElicitationRequest {
        let schema = ElicitationSchema::new().property(
            "account_id_secret",
            StringPropertySchema::new()
                .title("Account")
                .default_value("acct_123")
                .one_of(vec![
                    EnumOption::new("acct_123", "Work"),
                    EnumOption::new("acct_456", "Personal"),
                ]),
            true,
        );
        CreateElicitationRequest::new(
            ElicitationFormMode::new(ElicitationSessionScope::new("sess_test"), schema),
            "Pick account",
        )
    }

    #[test]
    fn normalizes_schema_without_persisting_raw_names_or_values() {
        let normalized =
            normalize_standard_mcp_elicitation(standard_select_request()).expect("should normalize");

        let public_json = serde_json::to_string(&normalized.payload).unwrap();
        assert!(!public_json.contains("account_id_secret"));
        assert!(!public_json.contains("acct_123"));
        assert!(!public_json.contains("default"));
        assert!(public_json.contains("Work"));
    }

    #[test]
    fn accepted_select_maps_generated_option_to_raw_value() {
        let normalized =
            normalize_standard_mcp_elicitation(standard_select_request()).expect("should normalize");

        let outcome = normalized
            .pending
            .accept(vec![McpElicitationSubmittedField {
                field_id: "field_1".to_string(),
                value: McpElicitationSubmittedValue::Option {
                    option_id: "field_1_option_1".to_string(),
                },
            }])
            .expect("submission should validate");

        let McpElicitationOutcome::Accepted { content, .. } = outcome else {
            panic!("expected accepted outcome");
        };
        assert_eq!(content, Some(json!({ "account_id_secret": "acct_123" })));
    }

    #[test]
    fn duplicate_multi_select_option_ids_are_rejected() {
        let normalized = normalize_form(
            "google".to_string(),
            "Pick accounts".to_string(),
            json!({
                "type": "object",
                "properties": {
                    "accounts": {
                        "type": "array",
                        "title": "Accounts",
                        "items": {
                            "oneOf": [
                                {"const": "acct_123", "title": "Work"},
                                {"const": "acct_456", "title": "Personal"}
                            ]
                        },
                        "minItems": 2
                    }
                },
                "required": ["accounts"]
            }),
        )
        .expect("schema should normalize");

        let error = normalized
            .pending
            .accept(vec![McpElicitationSubmittedField {
                field_id: "field_1".to_string(),
                value: McpElicitationSubmittedValue::OptionArray {
                    option_ids: vec![
                        "field_1_option_1".to_string(),
                        "field_1_option_1".to_string(),
                    ],
                },
            }])
            .expect_err("duplicate option ids should be rejected");
        assert_eq!(error, McpElicitationValidationError::InvalidValue);
    }

    #[test]
    fn url_payload_and_debug_do_not_expose_full_url() {
        let request = CreateElicitationRequest::new(
            ElicitationUrlMode::new(
                ElicitationSessionScope::new("sess_test"),
                ElicitationId::new("elic_test"),
                "https://accounts.example.com/oauth?token=secret-token",
            ),
            "Authorize",
        );
        let normalized =
            normalize_standard_mcp_elicitation(request).expect("url should normalize");

        let public_json = serde_json::to_string(&normalized.payload).unwrap();
        assert!(public_json.contains("https://accounts.example.com"));
        assert!(!public_json.contains("secret-token"));
        assert!(!public_json.contains("elic_test"));

        let debug = format!("{:?}", normalized.pending);
        assert!(!debug.contains("secret-token"));
        assert!(!debug.contains("elic_test"));
    }

    #[test]
    fn accepted_outcome_debug_redacts_submitted_values() {
        let schema = ElicitationSchema::new().string("account", true);
        let request = CreateElicitationRequest::new(
            ElicitationFormMode::new(ElicitationSessionScope::new("sess_test"), schema),
            "Name account",
        );
        let normalized =
            normalize_standard_mcp_elicitation(request).expect("schema should normalize");

        let outcome = normalized
            .pending
            .accept(vec![McpElicitationSubmittedField {
                field_id: "field_1".to_string(),
                value: McpElicitationSubmittedValue::String {
                    value: "submitted-secret".to_string(),
                },
            }])
            .expect("submission should validate");

        let debug = format!("{outcome:?}");
        assert!(!debug.contains("submitted-secret"));
        assert!(!debug.contains("account"));
        assert!(debug.contains("field_1"));
    }

    #[test]
    fn normalizes_claude_elicitation_to_shared_payload() {
        let normalized = normalize_claude_mcp_elicitation(ClaudeMcpElicitationExtParams {
            server_name: "calendar".to_string(),
            message: "Pick a calendar".to_string(),
            mode: Some("form".to_string()),
            url: None,
            requested_schema: Some(json!({
                "type": "object",
                "properties": {
                    "calendar_secret_id": {
                        "type": "string",
                        "title": "Calendar",
                        "enum": ["cal_raw_1", "cal_raw_2"],
                        "enumNames": ["Work", "Personal"]
                    }
                },
                "required": ["calendar_secret_id"],
                "additionalProperties": false
            })),
            title: Some("Calendar".to_string()),
            display_name: Some("Calendar".to_string()),
            description: None,
        })
        .expect("claude schema should normalize");

        let public_json = serde_json::to_string(&normalized.payload).unwrap();
        assert!(public_json.contains("Pick a calendar"));
        assert!(public_json.contains("Work"));
        assert!(!public_json.contains("calendar_secret_id"));
        assert!(!public_json.contains("cal_raw_1"));
    }

}
