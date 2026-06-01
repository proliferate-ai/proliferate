use anyharness_contract::v1::Session;

use super::error::ApiError;
use crate::app::AppState;
use crate::origin::OriginContext;

pub(super) async fn session_to_contract(
    state: &AppState,
    record: &crate::sessions::model::SessionRecord,
) -> Result<Session, ApiError> {
    state
        .session_runtime
        .session_to_contract(record)
        .await
        .map_err(|error| ApiError::internal(error.to_string()))
}

pub(super) fn request_origin_or_api_default(
    origin: Option<anyharness_contract::v1::OriginContext>,
    operation: &'static str,
) -> OriginContext {
    match origin {
        Some(origin) => OriginContext::from_contract(origin),
        None => {
            tracing::warn!(
                operation,
                "AnyHarness request omitted origin; defaulting to api/local_runtime"
            );
            OriginContext::api_local_runtime()
        }
    }
}
