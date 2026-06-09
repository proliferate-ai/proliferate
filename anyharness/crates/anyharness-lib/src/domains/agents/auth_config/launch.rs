use anyharness_contract::v1::{AgentAuthExternalScope, AgentAuthSelectionConfig};
use chrono::{DateTime, Utc};

use super::{AgentAuthLaunchOverlayError, AgentAuthSelectionRequired};

pub(super) fn selection_required_error(
    scope: Option<AgentAuthExternalScope>,
    agent_kind: &str,
    selection_status: &str,
) -> AgentAuthLaunchOverlayError {
    AgentAuthLaunchOverlayError::SelectionRequired(AgentAuthSelectionRequired {
        detail: format!(
            "Agent auth selection for {agent_kind} is required before launch ({selection_status})."
        ),
        resolution_scope: scope,
        agent_kind: agent_kind.to_string(),
        selection_status: selection_status.to_string(),
    })
}

pub(super) fn reject_expired_selection(selection: &AgentAuthSelectionConfig) -> anyhow::Result<()> {
    let Some(expires_at) = selection.expires_at.as_deref() else {
        return Ok(());
    };
    let expires_at = DateTime::parse_from_rfc3339(expires_at)
        .map_err(|error| anyhow::anyhow!("agent auth selection expiresAt is invalid: {error}"))?
        .with_timezone(&Utc);
    if expires_at <= Utc::now() {
        anyhow::bail!(
            "agent auth selection for {}/{} expired at {}",
            selection.agent_kind,
            selection.auth_slot_id,
            expires_at.to_rfc3339()
        );
    }
    Ok(())
}
