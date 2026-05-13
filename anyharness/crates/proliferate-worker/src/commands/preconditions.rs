use crate::anyharness_client::AnyHarnessClient;
use crate::cloud_client::commands::CloudCommand;
use crate::error::Result;

pub async fn check_local_preconditions(
    anyharness: &AnyHarnessClient,
    command: &CloudCommand,
) -> Result<Option<String>> {
    if let (Some(session_id), Some(observed_seq)) =
        (command.session_id.as_deref(), command.observed_event_seq)
    {
        let events = anyharness
            .list_session_events(session_id, Some(observed_seq - 1), Some(1))
            .await;
        if let Err(error) = events {
            return Ok(Some(format!(
                "could not verify observed_event_seq {observed_seq}: {error}"
            )));
        }
    }

    Ok(None)
}
