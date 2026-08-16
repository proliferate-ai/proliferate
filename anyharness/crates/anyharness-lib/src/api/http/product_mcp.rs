use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::Value;

use super::access::assert_workspace_mutable;
use super::error::ApiError;
use crate::app::AppState;
use crate::integrations::mcp::capability_token::McpCapabilityTokenValidation;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDispatchError,
    ProductMcpEndpointOperation, ProductMcpRequestContext, PRODUCT_MCP_TOKEN_HEADER_NAME,
};
use crate::observability::PRODUCT_MCP_AUTH_REJECTED_TRACING_TARGET;

pub async fn get_product_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id, _product_mcp_slug)): Path<(String, String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_product_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id, product_mcp_slug)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    dispatch_product_mcp(
        &state,
        &workspace_id,
        &session_id,
        &product_mcp_slug,
        headers,
        body,
    )
    .await
}

pub async fn dispatch_product_mcp(
    state: &AppState,
    workspace_id: &str,
    session_id: &str,
    product_mcp_slug: &str,
    headers: HeaderMap,
    body: Value,
) -> Result<Response, ApiError> {
    let server = state
        .product_mcp_endpoint_registry
        .get_by_route_slug(product_mcp_slug)
        .ok_or_else(|| ApiError::not_found("Product MCP not found.", "PRODUCT_MCP_NOT_FOUND"))?;
    let definition = server.definition();
    let request = ProductMcpRequestContext::new(workspace_id, session_id, definition.id);
    let endpoint_operation = ProductMcpEndpointOperation::from_request_body(&body);
    let Some(auth_header) = read_auth_header(&headers) else {
        return Err(reject_capability(
            &request,
            product_mcp_slug,
            "missing",
            "Product MCP capability token missing: the request did not carry the \
             x-anyharness-product-mcp-token header this endpoint requires.",
            definition.unauthorized_code,
        ));
    };
    let validation = server
        .validate_capability_token(auth_header, &request)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    match validation {
        McpCapabilityTokenValidation::Valid => {}
        // The token is delivered as a static header for the life of the
        // session, so a session that outlives the TTL arrives here on every
        // call. The signature already proved the runtime minted this exact
        // scope; the sessions domain, not the timestamp, decides whether the
        // capability is still alive.
        McpCapabilityTokenValidation::Expired => {
            let session_open = state
                .session_service
                .session_open_for_capability(session_id, workspace_id)
                .map_err(|error| ApiError::internal(error.to_string()))?;
            if !session_open {
                return Err(reject_capability(
                    &request,
                    product_mcp_slug,
                    "expired",
                    "Product MCP capability token expired and its session is no longer open. \
                     Start or resume the session to mint a fresh token.",
                    definition.unauthorized_code,
                ));
            }
            tracing::debug!(
                session_id = %request.session_id,
                workspace_id = %request.workspace_id,
                slug = product_mcp_slug,
                "product MCP capability token past TTL accepted for open session"
            );
        }
        McpCapabilityTokenValidation::InvalidSignature => {
            return Err(reject_capability(
                &request,
                product_mcp_slug,
                "invalid-signature",
                "Product MCP capability token is not valid for this runtime: the token is \
                 malformed or its signature does not verify.",
                definition.unauthorized_code,
            ));
        }
        McpCapabilityTokenValidation::ScopeMismatch => {
            return Err(reject_capability(
                &request,
                product_mcp_slug,
                "scope-mismatch",
                "Product MCP capability token is not scoped to this workspace, session, and \
                 product endpoint.",
                definition.unauthorized_code,
            ));
        }
    }

    let _lease = match server.endpoint_operation_kind(endpoint_operation) {
        None => None,
        Some(kind) => {
            let lease = state
                .workspace_operation_gate
                .acquire_shared(workspace_id, kind)
                .await;
            assert_workspace_mutable(state, workspace_id)?;
            Some(lease)
        }
    };

    let response = server
        .dispatch(request, body)
        .await
        .map_err(|error| map_dispatch_error(error, definition.request_invalid_code))?;

    match response {
        Some(payload) => Ok((StatusCode::OK, Json(payload)).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

/// Reject a capability header with the one observable trace of the failure.
///
/// The status is 403, not 401, on purpose: MCP clients treat 401 as an OAuth
/// challenge and run authorization-server discovery against the runtime root,
/// which fails with an unrelated parse error that masks the real cause. A 403
/// body passes through to the client verbatim, so the detail names the cause.
/// The event carries identifiers and the reason — never the token.
fn reject_capability(
    request: &ProductMcpRequestContext,
    slug: &str,
    reason: &'static str,
    detail: &'static str,
    unauthorized_code: &str,
) -> ApiError {
    tracing::warn!(
        target: PRODUCT_MCP_AUTH_REJECTED_TRACING_TARGET,
        session_id = %request.session_id,
        workspace_id = %request.workspace_id,
        slug,
        reason,
        "product MCP capability token rejected"
    );
    ApiError::forbidden(detail, unauthorized_code)
}

fn map_dispatch_error(error: ProductMcpDispatchError, request_invalid_code: &str) -> ApiError {
    match error {
        ProductMcpDispatchError::Context(ProductMcpContextError::NotFound(message)) => {
            ApiError::not_found(message, request_invalid_code)
        }
        ProductMcpDispatchError::Context(ProductMcpContextError::Conflict(message)) => {
            ApiError::conflict(message, request_invalid_code)
        }
        ProductMcpDispatchError::Context(ProductMcpContextError::Internal(error)) => {
            ApiError::internal(error.to_string())
        }
        ProductMcpDispatchError::Request(error) => {
            ApiError::bad_request(error.to_string(), request_invalid_code)
        }
    }
}

fn read_auth_header(headers: &HeaderMap) -> Option<ProductMcpAuthHeader<'_>> {
    headers
        .get(PRODUCT_MCP_TOKEN_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
        .map(|value| ProductMcpAuthHeader::Product { value })
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[test]
    fn context_dispatch_errors_map_to_not_found_or_conflict() {
        let not_found = map_dispatch_error(
            ProductMcpDispatchError::Context(ProductMcpContextError::not_found(
                "session not found",
            )),
            "PRODUCT_MCP_REQUEST_INVALID",
        );
        assert_eq!(not_found.into_response().status(), StatusCode::NOT_FOUND);

        let conflict = map_dispatch_error(
            ProductMcpDispatchError::Context(ProductMcpContextError::conflict(
                "session does not belong to workspace",
            )),
            "PRODUCT_MCP_REQUEST_INVALID",
        );
        assert_eq!(conflict.into_response().status(), StatusCode::CONFLICT);
    }

    #[test]
    fn request_dispatch_errors_stay_bad_request() {
        let error = map_dispatch_error(
            ProductMcpDispatchError::Request(anyhow::anyhow!("invalid request")),
            "PRODUCT_MCP_REQUEST_INVALID",
        );
        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }
}
