use super::super::schema::model::manifest::SupportSessionCollectionManifestV1;
use super::session_accounting::SessionInputError;

#[allow(clippy::too_many_arguments)]
pub(super) fn cross_check_collection(
    collection: &SupportSessionCollectionManifestV1,
    workspace_id: &str,
    anyharness_workspace_id: &str,
    sessions: u64,
    session_bytes: u64,
    event_bytes: u64,
    raw_bytes: u64,
    uncertain: u64,
    total_read_bytes: u64,
) -> Result<(), SessionInputError> {
    match collection {
        SupportSessionCollectionManifestV1::Included {
            workspace_id: declared_workspace,
            anyharness_workspace_id: declared_anyharness,
            selected_sessions,
            session_included_bytes,
            event_included_bytes,
            raw_notification_included_bytes,
            limit_uncertain_endpoints,
        } if declared_workspace == workspace_id
            && declared_anyharness == anyharness_workspace_id
            && *selected_sessions == sessions
            && *session_included_bytes == session_bytes
            && *event_included_bytes == event_bytes
            && *raw_notification_included_bytes == raw_bytes
            && *limit_uncertain_endpoints == uncertain
            && total_read_bytes
                >= session_bytes
                    .checked_add(event_bytes)
                    .and_then(|value| value.checked_add(raw_bytes))
                    .ok_or(SessionInputError::Invalid)? =>
        {
            Ok(())
        }
        _ => Err(SessionInputError::Incoherent),
    }
}
