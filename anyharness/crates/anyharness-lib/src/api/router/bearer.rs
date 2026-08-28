//! Bearer-token extraction and the direct-attach error mapping the router's
//! auth middleware runs on every request.
//!
//! Split out of `router.rs` when the forward merge put the route table over the
//! line cap: the table and the credential parsing are different concerns, and
//! nothing here reads a route. Behavior is byte-identical to the inline
//! version; `router_tests.rs` exercises it through the middleware.

use axum::http::{header, HeaderMap};
use subtle::ConstantTimeEq;
use url::form_urlencoded;

use crate::api::auth::AuthError;
use crate::api::http::error::ApiError;

pub(super) fn auth_error_to_api(error: AuthError) -> ApiError {
    match error {
        AuthError::InvalidToken | AuthError::Revoked | AuthError::NotConfigured => {
            ApiError::unauthorized(
                "A valid direct-attach token is required for this AnyHarness runtime.",
                "UNAUTHORIZED",
            )
        }
        AuthError::UnsupportedRoute => ApiError::forbidden(
            "Direct-attach tokens cannot access this AnyHarness route.",
            "DIRECT_ATTACH_ROUTE_FORBIDDEN",
        ),
        AuthError::InsufficientPermission => ApiError::forbidden(
            "Direct-attach token does not grant the required permission.",
            "DIRECT_ATTACH_PERMISSION_DENIED",
        ),
        AuthError::ScopeMismatch => ApiError::forbidden(
            "Direct-attach token is not scoped to this resource.",
            "DIRECT_ATTACH_SCOPE_MISMATCH",
        ),
    }
}

pub(super) fn token_is_jwt(token: &str) -> bool {
    token.split('.').count() == 3
}

pub(super) fn bearer_tokens_match(provided: Option<&str>, expected: &str) -> bool {
    let provided_bytes = provided.unwrap_or("").as_bytes();
    let expected_bytes = expected.as_bytes();
    bool::from(provided_bytes.ct_eq(expected_bytes))
}

pub(super) fn extract_bearer_token(headers: &HeaderMap, query: Option<&str>) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        if let Some(token) = value.strip_prefix("Bearer ") {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_owned());
            }
        }
    }

    query.and_then(|query| {
        form_urlencoded::parse(query.as_bytes()).find_map(|(key, value)| {
            if key == "access_token" && !value.is_empty() {
                Some(value.into_owned())
            } else {
                None
            }
        })
    })
}
