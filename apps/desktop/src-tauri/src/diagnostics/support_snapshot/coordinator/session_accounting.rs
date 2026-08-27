use super::super::schema::enums::{SupportEvidenceSourceV1, SupportOmissionReasonV1};
use super::super::schema::model::common::SupportOmissionV1;
use super::super::scrub::SupportScrubAccounting;
use super::session_input::EndpointFailureReason;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SessionInputError {
    TooLarge,
    Invalid,
    Incoherent,
    Scrub,
}

pub(super) fn note_invalid_items(count: u64, accounting: &mut SupportScrubAccounting) {
    if count == 0 {
        return;
    }
    accounting.omissions.push(SupportOmissionV1 {
        source: SupportEvidenceSourceV1::SessionLedger,
        reason: SupportOmissionReasonV1::SessionInvalid,
        count,
        known_bytes: None,
    });
}

pub(super) fn note_endpoint_reason(
    reason: Option<EndpointFailureReason>,
    accounting: &mut SupportScrubAccounting,
) {
    let reason = match reason {
        Some(EndpointFailureReason::Unavailable) => SupportOmissionReasonV1::SessionUnavailable,
        Some(EndpointFailureReason::Timeout) => SupportOmissionReasonV1::SessionTimeout,
        Some(EndpointFailureReason::Invalid) => SupportOmissionReasonV1::SessionInvalid,
        Some(EndpointFailureReason::WindowLimitUncertain) => {
            SupportOmissionReasonV1::SessionWindowLimitUncertain
        }
        None => return,
    };
    accounting.omissions.push(SupportOmissionV1 {
        source: SupportEvidenceSourceV1::SessionLedger,
        reason,
        count: 1,
        known_bytes: None,
    });
}

pub(super) fn note_live_config_not_collected(count: u64, accounting: &mut SupportScrubAccounting) {
    if count == 0 {
        return;
    }
    accounting.omissions.push(SupportOmissionV1 {
        source: SupportEvidenceSourceV1::SessionLedger,
        reason: SupportOmissionReasonV1::LiveConfigNotCollected,
        count,
        known_bytes: None,
    });
}
