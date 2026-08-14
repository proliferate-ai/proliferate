use anyharness_contract::v1::{
    AnyHarnessBoundedWindowCompletenessV1, AnyHarnessBoundedWindowMetaV1,
    AnyHarnessBoundedWindowPresentationOrderV1, AnyHarnessBoundedWindowSelectionV1,
    AnyHarnessEventSupportWindowV1, AnyHarnessRawNotificationSupportWindowV1,
    AnyHarnessSessionSupportWindowV1,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(
        super::super::http::support_windows::list_sessions_support_window,
        super::super::http::support_windows::list_session_events_support_window,
        super::super::http::support_windows::list_session_raw_notifications_support_window,
    ),
    components(schemas(
        AnyHarnessBoundedWindowSelectionV1,
        AnyHarnessBoundedWindowPresentationOrderV1,
        AnyHarnessBoundedWindowCompletenessV1,
        AnyHarnessBoundedWindowMetaV1,
        AnyHarnessSessionSupportWindowV1,
        AnyHarnessEventSupportWindowV1,
        AnyHarnessRawNotificationSupportWindowV1,
    ))
)]
pub(super) struct SupportWindowsApiDoc;

pub(super) fn merge(api: utoipa::openapi::OpenApi) -> utoipa::openapi::OpenApi {
    api.merge_from(SupportWindowsApiDoc::openapi())
}
