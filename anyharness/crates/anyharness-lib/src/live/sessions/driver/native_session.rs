use super::*;
use crate::live::sessions::actor::state::SessionStartupStrategy;
use crate::live::sessions::driver::start::start_new_session;
use crate::live::sessions::driver::types::{
    NativeSessionStartupDisposition, NativeSessionStartupState,
};
use anyharness_contract::v1::SessionActionCapabilities;

pub(in crate::live::sessions) fn build_system_prompt_meta(
    system_prompt_append: Option<&str>,
) -> Option<acp::schema::Meta> {
    let append = system_prompt_append?.trim();
    if append.is_empty() {
        return None;
    }

    Some(acp::schema::Meta::from_iter([(
        "systemPrompt".to_string(),
        serde_json::json!({
            "append": append,
        }),
    )]))
}

pub(in crate::live::sessions) fn is_missing_load_session_resource(
    error: &acp::Error,
    expected_uri: &str,
) -> bool {
    if !matches!(error.code, acp::ErrorCode::ResourceNotFound) {
        return false;
    }

    match error
        .data
        .as_ref()
        .and_then(|data| data.get("uri"))
        .and_then(|uri| uri.as_str())
    {
        Some(uri) => uri == expected_uri,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_system_prompt_meta_uses_append_shape() {
        let meta = build_system_prompt_meta(Some("Rename the branch")).expect("meta");

        assert_eq!(
            serde_json::to_value(&meta).ok(),
            Some(serde_json::json!({
                "systemPrompt": {
                    "append": "Rename the branch",
                },
            }))
        );
    }

    #[test]
    fn build_system_prompt_meta_skips_blank_values() {
        assert!(build_system_prompt_meta(None).is_none());
        assert!(build_system_prompt_meta(Some("   ")).is_none());
    }

    #[test]
    fn missing_load_session_resource_matches_expected_uri() {
        let error = acp::Error::resource_not_found(Some("session-123".to_string()));
        assert!(is_missing_load_session_resource(&error, "session-123"));
        assert!(!is_missing_load_session_resource(&error, "session-xyz"));
    }

    #[test]
    fn missing_load_session_resource_without_uri_still_matches() {
        let error = acp::Error::resource_not_found(None);
        assert!(is_missing_load_session_resource(&error, "session-123"));
    }

    #[test]
    fn missing_load_session_resource_ignores_other_error_codes() {
        let error = acp::Error::internal_error().data(serde_json::json!({
            "uri": "session-123",
        }));
        assert!(!is_missing_load_session_resource(&error, "session-123"));
    }
}

pub(in crate::live::sessions) fn has_anyharness_targeted_fork_extension(meta: &acp::schema::Meta) -> bool {
    let Some(anyharness) = meta.get("anyharness").and_then(|value| value.as_object()) else {
        return false;
    };
    if anyharness
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        != Some(1)
    {
        return false;
    }
    let Some(targeted_fork) = anyharness
        .get("targetedFork")
        .and_then(|value| value.as_object())
    else {
        return false;
    };
    if targeted_fork
        .get("fileEffects")
        .and_then(|value| value.as_str())
        != Some("none")
    {
        return false;
    }
    matches!(
        targeted_fork.get("target").and_then(|value| value.as_str()),
        Some("message_id" | "user_message_index")
    )
}

pub(in crate::live::sessions) async fn start_native_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    workspace_path: &std::path::PathBuf,
    mcp_servers: &[SessionMcpServer],
    system_prompt_append: Option<&str>,
    startup_strategy: &SessionStartupStrategy,
    action_capabilities: SessionActionCapabilities,
    session_id: &str,
    workspace_id: &str,
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
) -> anyhow::Result<(
    String,
    NativeSessionStartupState,
    NativeSessionStartupDisposition,
)> {
    let startup_strategy_label = startup_strategy.as_str();
    match startup_strategy {
        SessionStartupStrategy::Fresh | SessionStartupStrategy::ResumeSeqFreshNative => {
            let new_session_resp = match start_new_session(
                conn,
                workspace_path,
                mcp_servers,
                system_prompt_append,
                session_id,
                workspace_id,
                startup_strategy_label,
                "[workspace-latency] session.actor.new_session.completed",
                "[workspace-latency] session.actor.new_session.failed",
            )
            .await
            {
                Ok(resp) => resp,
                Err(error) => {
                    let _ = ready_tx.send(Err(anyhow::anyhow!("ACP new_session: {error}")));
                    return Err(anyhow::anyhow!("ACP new_session: {error}"));
                }
            };

            Ok((
                new_session_resp.session_id.to_string(),
                NativeSessionStartupState::from_new_session(&new_session_resp),
                NativeSessionStartupDisposition::CreatedFresh,
            ))
        }
        SessionStartupStrategy::LoadNative(existing)
        | SessionStartupStrategy::LoadNativeNoFallback(existing) => {
            let load_started = std::time::Instant::now();
            match conn
                .send_request(
                    acp::schema::LoadSessionRequest::new(existing.clone(), workspace_path.clone())
                        .mcp_servers(to_acp_servers(mcp_servers))
                        .meta(build_system_prompt_meta(system_prompt_append)),
                )
                .block_task()
                .await
            {
                Ok(resp) => {
                    tracing::info!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        native_session_id = %existing,
                        startup_strategy = startup_strategy_label,
                        native_startup_disposition = NativeSessionStartupDisposition::LoadedExisting.as_str(),
                        elapsed_ms = load_started.elapsed().as_millis(),
                        "[workspace-latency] session.actor.load_session.completed"
                    );
                    Ok((
                        existing.clone(),
                        NativeSessionStartupState::from_load_session(&resp),
                        NativeSessionStartupDisposition::LoadedExisting,
                    ))
                }
                Err(e)
                    if startup_strategy.allows_missing_load_fallback()
                        && is_missing_load_session_resource(&e, existing) =>
                {
                    tracing::warn!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        native_session_id = %existing,
                        startup_strategy = startup_strategy_label,
                        elapsed_ms = load_started.elapsed().as_millis(),
                        error = %e,
                        "ACP load_session resource missing; falling back to new_session"
                    );

                    let new_session_resp = match start_new_session(
                        conn,
                        workspace_path,
                        mcp_servers,
                        system_prompt_append,
                        session_id,
                        workspace_id,
                        startup_strategy_label,
                        "[workspace-latency] session.actor.new_session_after_missing_load.completed",
                        "[workspace-latency] session.actor.new_session_after_missing_load.failed",
                    )
                    .await
                    {
                        Ok(resp) => resp,
                        Err(error) => {
                            let _ = ready_tx.send(Err(anyhow::anyhow!(
                                "ACP new_session after missing load_session resource: {error}"
                            )));
                            return Err(anyhow::anyhow!(
                                "ACP new_session after missing load_session resource: {error}"
                            ));
                        }
                    };

                    Ok((
                        new_session_resp.session_id.to_string(),
                        NativeSessionStartupState::from_new_session(&new_session_resp),
                        NativeSessionStartupDisposition::CreatedFresh,
                    ))
                }
                Err(e) => {
                    tracing::warn!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        native_session_id = %existing,
                        startup_strategy = startup_strategy_label,
                        elapsed_ms = load_started.elapsed().as_millis(),
                        error = %e,
                        "[workspace-latency] session.actor.load_session.failed"
                    );
                    let _ = ready_tx.send(Err(anyhow::anyhow!("ACP load_session: {e}")));
                    Err(anyhow::anyhow!("ACP load_session: {e}"))
                }
            }
        }
        SessionStartupStrategy::ForkFromNative {
            parent_native_session_id,
        } => {
            if !action_capabilities.fork {
                let error = anyhow::anyhow!(
                    "agent does not advertise ACP session/fork with load_session support"
                );
                let _ = ready_tx.send(Err(anyhow::anyhow!("{error}")));
                return Err(error);
            }

            let fork_started = std::time::Instant::now();
            let mut request = acp::schema::ForkSessionRequest::new(
                parent_native_session_id.clone(),
                workspace_path.clone(),
            )
            .mcp_servers(to_acp_servers(mcp_servers))
            .meta(build_system_prompt_meta(system_prompt_append));
            if mcp_servers.is_empty() {
                request.mcp_servers.clear();
            }

            match conn.send_request(request).block_task().await {
                Ok(resp) => {
                    tracing::info!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        parent_native_session_id = %parent_native_session_id,
                        native_session_id = %resp.session_id,
                        startup_strategy = startup_strategy_label,
                        native_startup_disposition = NativeSessionStartupDisposition::CreatedFresh.as_str(),
                        elapsed_ms = fork_started.elapsed().as_millis(),
                        "[workspace-latency] session.actor.fork_session.completed"
                    );
                    Ok((
                        resp.session_id.to_string(),
                        NativeSessionStartupState::from_fork_session(&resp),
                        NativeSessionStartupDisposition::CreatedFresh,
                    ))
                }
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        parent_native_session_id = %parent_native_session_id,
                        startup_strategy = startup_strategy_label,
                        elapsed_ms = fork_started.elapsed().as_millis(),
                        error = %error,
                        "[workspace-latency] session.actor.fork_session.failed"
                    );
                    let _ = ready_tx.send(Err(anyhow::anyhow!("ACP fork_session: {error}")));
                    Err(anyhow::anyhow!("ACP fork_session: {error}"))
                }
            }
        }
    }
}
