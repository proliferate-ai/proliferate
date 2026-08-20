use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionLiveConfigSnapshot;
use tokio::sync::Mutex;

use crate::domains::sessions::live_config::validate_canonical_live_config_current;
use crate::live::sessions::actor::config::apply::apply_config_option_if_possible;
use crate::live::sessions::actor::config::confirmation::ensure_config_values_confirmed;
use crate::live::sessions::actor::config::persist::emit_live_config_update;
use crate::live::sessions::actor::config::types::{
    ConfigApplyOutcome, PersistedSessionConfigState,
};
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::model::SessionStateDurable;
use crate::live::sessions::sink::SessionEventSink;

pub(in crate::live::sessions::actor) async fn restore_persisted_live_config_if_needed(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &dyn SessionStateDurable,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    persisted_snapshot: Option<&SessionLiveConfigSnapshot>,
) -> anyhow::Result<()> {
    let Some(snapshot) = persisted_snapshot else {
        return Ok(());
    };
    let desired = canonical_restore_values(snapshot)?;
    if desired.is_empty() {
        return Ok(());
    }

    let mut changed = false;
    for (_, config_id, value) in &desired {
        let outcome = apply_config_option_if_possible(
            conn,
            native_session_id,
            startup_state,
            config_id,
            value,
        )
        .await?;
        anyhow::ensure!(
            matches!(
                outcome,
                ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative
            ),
            "saved control '{config_id}' value '{value}' is absent, rejected, or unconfirmed by the live session"
        );
        if outcome == ConfigApplyOutcome::AppliedAuthoritative {
            changed = true;
        }
    }
    ensure_config_values_confirmed(startup_state, &desired, "saved")?;

    if changed {
        emit_live_config_update(
            source_agent_kind,
            session_id,
            store,
            event_sink,
            persisted_config_state,
            startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await?;
    }

    Ok(())
}

/// Reads resume intent only from the frozen full-snapshot vocabulary. The
/// normalized/raw compatibility fields are presentation and rollback data;
/// allowing them to drive restore would create a second active authority.
///
/// Model is first, then controls retain the exact saved harness order. The
/// saved current map must be complete and every current value must still be a
/// member of its own saved option row before we compare it with the new live
/// handshake.
pub(in crate::live::sessions::actor) fn canonical_restore_values(
    snapshot: &SessionLiveConfigSnapshot,
) -> anyhow::Result<Vec<(usize, String, String)>> {
    validate_canonical_live_config_current(snapshot)?;
    let mut desired = Vec::with_capacity(snapshot.controls.len() + 1);

    if let Some(model_id) = snapshot.current.model_id.as_deref() {
        desired.push((0, "model".to_string(), model_id.to_string()));
    }

    for (index, control) in snapshot.controls.iter().enumerate() {
        let value = snapshot
            .current
            .control_values
            .get(&control.id)
            .ok_or_else(|| {
                anyhow::anyhow!("saved live control '{}' has no current value", control.id)
            })?;
        desired.push((index + 1, control.id.clone(), value.clone()));
    }

    Ok(desired)
}
