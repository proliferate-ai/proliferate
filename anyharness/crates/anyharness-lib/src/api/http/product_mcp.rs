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
use crate::domains::sessions::mcp_bindings::product_registry::{
    legacy_route_aliases, ProductMcpEndpointHandler,
};
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDispatchError,
    ProductMcpEndpointOperation, ProductMcpRequestContext, PRODUCT_MCP_TOKEN_HEADER_NAME,
};

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

pub async fn get_subagents_legacy_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_subagents_legacy_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    dispatch_product_mcp(
        &state,
        &workspace_id,
        &session_id,
        legacy_route_aliases::SUBAGENTS,
        headers,
        body,
    )
    .await
}

pub async fn get_reviews_legacy_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_reviews_legacy_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    dispatch_product_mcp(
        &state,
        &workspace_id,
        &session_id,
        legacy_route_aliases::REVIEWS,
        headers,
        body,
    )
    .await
}

pub async fn get_workspace_naming_legacy_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_workspace_naming_legacy_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    dispatch_product_mcp(
        &state,
        &workspace_id,
        &session_id,
        legacy_route_aliases::WORKSPACE_NAMING,
        headers,
        body,
    )
    .await
}

pub async fn get_cowork_legacy_mcp_endpoint(
    State(_state): State<AppState>,
    Path((_workspace_id, _session_id)): Path<(String, String)>,
) -> impl IntoResponse {
    StatusCode::NO_CONTENT
}

pub async fn post_cowork_legacy_mcp_endpoint(
    State(state): State<AppState>,
    Path((workspace_id, session_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    dispatch_product_mcp(
        &state,
        &workspace_id,
        &session_id,
        legacy_route_aliases::COWORK,
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
    let auth_header = read_auth_header(server, &headers).ok_or_else(|| {
        ApiError::unauthorized(
            "Missing product MCP capability token.",
            definition.unauthorized_code,
        )
    })?;
    let validation = server
        .validate_capability_token(auth_header, &request)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if !validation.is_valid() {
        return Err(ApiError::unauthorized(
            "Invalid product MCP capability token.",
            definition.unauthorized_code,
        ));
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

fn read_auth_header<'a>(
    server: &dyn ProductMcpEndpointHandler,
    headers: &'a HeaderMap,
) -> Option<ProductMcpAuthHeader<'a>> {
    if let Some(value) = headers
        .get(PRODUCT_MCP_TOKEN_HEADER_NAME)
        .and_then(|value| value.to_str().ok())
    {
        return Some(ProductMcpAuthHeader::Product { value });
    }

    server.legacy_header_names().iter().find_map(|name| {
        headers
            .get(*name)
            .and_then(|value| value.to_str().ok())
            .map(|value| ProductMcpAuthHeader::Legacy { name, value })
    })
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
