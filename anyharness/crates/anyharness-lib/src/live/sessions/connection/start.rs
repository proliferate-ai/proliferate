use super::*;
use crate::live::sessions::connection::native_session::build_system_prompt_meta;
use crate::live::sessions::connection::types::NativeSessionStartupDisposition;
use acp::Agent as _;
use std::time::Instant;
pub(in crate::live::sessions) fn build_client_capabilities(
    source_agent_kind: &str,
    resolved_agent: &ResolvedAgent,
) -> acp::ClientCapabilities {
    let mut meta = serde_json::Map::new();

    if source_agent_kind == AgentKind::Codex.as_str() {
        let mut codex_capabilities = serde_json::Map::from_iter([(
            "requestUserInput".to_string(),
            serde_json::Value::Bool(true),
        )]);
        if should_advertise_codex_mcp_elicitation(source_agent_kind, resolved_agent) {
            codex_capabilities.insert("mcpElicitation".to_string(), serde_json::Value::Bool(true));
        }
        meta.insert(
            "codex".to_string(),
            serde_json::Value::Object(codex_capabilities),
        );
    }

    if source_agent_kind == AgentKind::Claude.as_str() {
        meta.insert(
            "claude".to_string(),
            serde_json::Value::Object(serde_json::Map::from_iter([(
                "mcpElicitation".to_string(),
                serde_json::Value::Bool(true),
            )])),
        );
    }

    acp::ClientCapabilities::new().meta(acp::Meta::from_iter(meta))
}

pub(in crate::live::sessions) fn should_advertise_codex_mcp_elicitation(
    source_agent_kind: &str,
    resolved_agent: &ResolvedAgent,
) -> bool {
    source_agent_kind == AgentKind::Codex.as_str()
        && resolved_agent.agent_process.source.as_deref() == Some("override")
}

pub(in crate::live::sessions) async fn initialize_connection(
    conn: &acp::ClientSideConnection,
    source_agent_kind: &str,
    resolved_agent: &ResolvedAgent,
    session_id: &str,
    workspace_id: &str,
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
) -> anyhow::Result<acp::InitializeResponse> {
    let initialize_started = Instant::now();
    let client_capabilities = build_client_capabilities(source_agent_kind, resolved_agent);
    let init_response = match conn
        .initialize(
            acp::InitializeRequest::new(acp::ProtocolVersion::V1)
                .client_info(acp::Implementation::new("anyharness", "0.1.0"))
                .client_capabilities(client_capabilities),
        )
        .await
    {
        Ok(resp) => {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                auth_method_count = resp.auth_methods.len(),
                elapsed_ms = initialize_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.acp_initialize.completed"
            );
            resp
        }
        Err(e) => {
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                elapsed_ms = initialize_started.elapsed().as_millis(),
                error = %e,
                "[workspace-latency] session.actor.acp_initialize.failed"
            );
            let _ = ready_tx.send(Err(anyhow::anyhow!("ACP initialize: {e}")));
            return Err(anyhow::anyhow!("ACP initialize: {e}"));
        }
    };

    authenticate_if_advertised(conn, &init_response, session_id, workspace_id).await;
    Ok(init_response)
}

async fn authenticate_if_advertised(
    conn: &acp::ClientSideConnection,
    init_response: &acp::InitializeResponse,
    session_id: &str,
    workspace_id: &str,
) {
    // Some agents require authenticate before new_session; others advertise
    // auth methods but do not require the call. We attempt it and let
    // new_session be the authoritative gate.
    if init_response.auth_methods.is_empty() {
        return;
    }

    let method_id = init_response.auth_methods[0].id().clone();
    let authenticate_started = Instant::now();
    tracing::info!(
        session_id = %session_id,
        method_id = %method_id,
        "agent advertises auth methods, calling authenticate"
    );
    match conn
        .authenticate(acp::AuthenticateRequest::new(method_id.clone()))
        .await
    {
        Ok(_) => {
            tracing::info!(session_id = %session_id, "ACP authentication succeeded");
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                method_id = %method_id,
                elapsed_ms = authenticate_started.elapsed().as_millis(),
                "[workspace-latency] session.actor.acp_authenticate.completed"
            );
        }
        Err(e) => {
            tracing::warn!(
                session_id = %session_id,
                method_id = %method_id,
                error = %e,
                "ACP authenticate failed (non-fatal, will attempt new_session anyway)"
            );
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                method_id = %method_id,
                elapsed_ms = authenticate_started.elapsed().as_millis(),
                error = %e,
                "[workspace-latency] session.actor.acp_authenticate.failed_non_fatal"
            );
        }
    }
}

pub(in crate::live::sessions) async fn start_new_session(
    conn: &acp::ClientSideConnection,
    workspace_path: &std::path::PathBuf,
    mcp_servers: &[SessionMcpServer],
    system_prompt_append: Option<&str>,
    session_id: &str,
    workspace_id: &str,
    startup_strategy: &str,
    completed_event: &str,
    failed_event: &str,
) -> anyhow::Result<acp::NewSessionResponse> {
    let mut request = acp::NewSessionRequest::new(workspace_path.clone());
    if !mcp_servers.is_empty() {
        request = request.mcp_servers(to_acp_servers(mcp_servers));
    }
    if let Some(meta) = build_system_prompt_meta(system_prompt_append) {
        tracing::debug!(
            session_id = %session_id,
            startup_strategy,
            system_prompt_append = system_prompt_append.unwrap_or_default(),
            system_prompt_append_len = system_prompt_append.map(|value| value.len()).unwrap_or(0),
            "attaching ACP startup system prompt append to new_session"
        );
        request = request.meta(meta);
    }

    let system_prompt_append_len = system_prompt_append
        .map(|value| value.len())
        .unwrap_or_default();
    let new_session_started = Instant::now();
    tracing::info!(
        session_id = %session_id,
        workspace_id = %workspace_id,
        startup_strategy,
        mcp_server_count = mcp_servers.len(),
        system_prompt_append_len,
        "[workspace-latency] session.actor.new_session.start"
    );
    match conn.new_session(request).await {
        Ok(resp) => {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                native_session_id = %resp.session_id,
                startup_strategy,
                startup_event = completed_event,
                detail = "ACP new_session completed",
                native_startup_disposition = NativeSessionStartupDisposition::CreatedFresh.as_str(),
                elapsed_ms = new_session_started.elapsed().as_millis(),
                "{}",
                completed_event
            );
            Ok(resp)
        }
        Err(error) => {
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                startup_strategy,
                startup_event = failed_event,
                detail = "ACP new_session failed",
                elapsed_ms = new_session_started.elapsed().as_millis(),
                error = %error,
                "{}",
                failed_event
            );
            Err(anyhow::anyhow!("{error}"))
        }
    }
}
