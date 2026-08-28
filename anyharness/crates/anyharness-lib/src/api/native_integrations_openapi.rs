//! OpenAPI document for the native-integrations routes, merged into the main
//! doc by `openapi_json` (the same split `subagents_openapi` uses, keeping
//! `openapi.rs` under its size ratchet).

use anyharness_contract::v1::{
    NativeIntegration, NativeIntegrationKind, NativeIntegrationRisk,
    NativeIntegrationSelectionRequest, NativeIntegrationsResponse,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        super::http::agent_native_integrations::list_native_integrations,
        super::http::agent_native_integrations::set_native_integration_selection,
    ),
    components(schemas(
        NativeIntegrationKind,
        NativeIntegrationRisk,
        NativeIntegration,
        NativeIntegrationsResponse,
        NativeIntegrationSelectionRequest,
    ))
)]
pub(super) struct NativeIntegrationsApiDoc;
