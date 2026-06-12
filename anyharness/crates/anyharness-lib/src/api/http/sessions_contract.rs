use anyharness_contract::v1::Session;

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::sessions::runtime::view::SessionView;
use crate::origin::OriginContext;

/// Dep-less mapper: domain [`SessionView`] → wire `Session`. No IO, no state.
pub(super) fn session_view_to_contract(view: SessionView) -> Session {
    view.into_contract()
}

pub(super) async fn session_to_contract(
    state: &AppState,
    record: &crate::domains::sessions::model::SessionRecord,
) -> Result<Session, ApiError> {
    state
        .session_runtime
        .session_view(record)
        .await
        .map(session_view_to_contract)
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
