use chrono::{DateTime, Utc};

use super::super::super::schema::enums::SupportEndpointStateV1;
use super::super::super::schema::limits::MAX_SAFE_INTEGER;
use super::super::super::schema::validate::validate_timestamp;
use super::{
    BoundedWindowMetaV1, EndpointCaptureState, EndpointFailureReason, SessionInputError,
    WindowCompletenessV1, WindowPresentationOrderV1, WindowSelectionV1,
};

pub(super) fn summary_presence_is_coherent(
    state: SupportEndpointStateV1,
    returned_items: u64,
    has_payload: bool,
) -> bool {
    match state {
        SupportEndpointStateV1::Included => has_payload && returned_items > 0,
        SupportEndpointStateV1::Omitted => !has_payload && returned_items == 0,
        SupportEndpointStateV1::LimitUncertain => has_payload == (returned_items > 0),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validate_endpoint(
    captured_at: &str,
    state: EndpointCaptureState,
    reason: Option<EndpointFailureReason>,
    included_bytes: u64,
    window: &BoundedWindowMetaV1,
    item_cap: u64,
    response_cap: u64,
    order: WindowPresentationOrderV1,
    session_phase_started_at: &str,
) -> Result<SupportEndpointStateV1, SessionInputError> {
    validate_timestamp(captured_at).map_err(|_| SessionInputError::Invalid)?;
    let captured = DateTime::parse_from_rfc3339(captured_at)
        .map_err(|_| SessionInputError::Invalid)?
        .with_timezone(&Utc);
    let session_phase = DateTime::parse_from_rfc3339(session_phase_started_at)
        .map_err(|_| SessionInputError::Invalid)?
        .with_timezone(&Utc);
    if captured < session_phase || captured > session_phase + chrono::Duration::seconds(5) {
        return Err(SessionInputError::Incoherent);
    }
    if window.schema_version != 1
        || window.selection != WindowSelectionV1::NewestMatching
        || window.presentation_order != order
        || window.item_limit != item_cap
        || window.response_byte_limit != response_cap
        || window.returned_items > window.item_limit
        || window.omitted_oversized_items > MAX_SAFE_INTEGER
        || window.omitted_oversized_items > item_cap.saturating_add(1)
        || included_bytes > window.response_byte_limit
        || (window.returned_items == 0 && included_bytes != 0)
    {
        return Err(SessionInputError::Incoherent);
    }
    match (state, reason, window.completeness) {
        (EndpointCaptureState::Included, None, WindowCompletenessV1::Complete)
            if window.omitted_oversized_items == 0 =>
        {
            Ok(SupportEndpointStateV1::Included)
        }
        (
            EndpointCaptureState::LimitUncertain,
            Some(EndpointFailureReason::WindowLimitUncertain),
            WindowCompletenessV1::LimitUncertain,
        ) => Ok(SupportEndpointStateV1::LimitUncertain),
        (
            EndpointCaptureState::Omitted,
            Some(
                EndpointFailureReason::Unavailable
                | EndpointFailureReason::Timeout
                | EndpointFailureReason::Invalid,
            ),
            _,
        ) if included_bytes == 0
            && window.returned_items == 0
            && window.omitted_oversized_items == 0
            && window.completeness == WindowCompletenessV1::Complete =>
        {
            Ok(SupportEndpointStateV1::Omitted)
        }
        _ => Err(SessionInputError::Incoherent),
    }
}
