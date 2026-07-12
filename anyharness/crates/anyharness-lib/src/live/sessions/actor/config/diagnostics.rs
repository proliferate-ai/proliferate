pub(in crate::live::sessions::actor) fn trace_native_variant(
    native_session_id: &str,
    config_id: &str,
    requested: &str,
    resolved: &str,
) {
    if requested == resolved {
        return;
    }

    tracing::debug!(
        native_session_id,
        config_id,
        requested,
        resolved,
        "[model-switch] resolved bare model variant from live ACP config"
    );
}

pub(in crate::live::sessions::actor) fn trace_session_variant(
    session_id: &str,
    config_id: &str,
    requested: &str,
    resolved: &str,
) {
    if requested == resolved {
        return;
    }

    tracing::debug!(
        session_id,
        config_id,
        requested,
        resolved,
        "[model-switch] resolved bare model variant from live ACP config"
    );
}
