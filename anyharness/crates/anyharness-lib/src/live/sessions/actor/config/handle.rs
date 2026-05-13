use crate::live::sessions::actor::*;
pub(in crate::live::sessions::actor) async fn apply_requested_session_preferences(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    session: &SessionRecord,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<()> {
    if let Some(model_id) = session.requested_model_id.as_deref() {
        match try_apply_model_preference(conn, native_session_id, model_id, startup_state).await {
            Ok(_) => {}
            Err(error) => {
                // Model prefs are best-effort at startup because live ACP/provider IDs can
                // drift while the session remains usable. Mode prefs stay strict below.
                tracing::warn!(
                    native_session_id,
                    requested_model_id = model_id,
                    error = %error,
                    "failed to apply requested model; keeping agent-selected model"
                );
            }
        }
    }
    if let Some(mode_id) = session.requested_mode_id.as_deref() {
        let outcome = try_apply_config_option(
            conn,
            native_session_id,
            startup_state,
            ConfigPurpose::Mode,
            mode_id,
        )
        .await?;
        if outcome == ConfigApplyOutcome::NotApplied {
            let _ = apply_mode_via_direct_setter_legacy(
                conn,
                native_session_id,
                startup_state,
                mode_id,
            )
            .await?;
        }
    }

    Ok(())
}
