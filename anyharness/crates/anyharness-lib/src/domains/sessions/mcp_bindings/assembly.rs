use std::collections::HashSet;
use std::sync::Arc;

use anyharness_contract::v1::SessionMcpBindingSummary;

use super::crypto::SessionDataCipher;
use super::model::SessionMcpServer;
use super::product_catalog::ProductMcpLaunchCatalog;
use super::summaries::serialize_binding_summaries;
use crate::domains::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras,
};
use crate::domains::sessions::model::SessionRecord;
use crate::domains::workspaces::model::WorkspaceRecord;

pub const SESSION_RESTART_REQUIRED_DETAIL: &str =
    "This session's MCP bindings can't be decrypted. Please restart the session.";

#[derive(Debug)]
pub struct SessionMcpLaunchAssembly {
    pub mcp_servers: Vec<SessionMcpServer>,
    pub system_prompt_append: Option<String>,
    pub first_prompt_system_prompt_append: Option<String>,
    pub mcp_binding_summaries_json: Option<String>,
}

#[derive(Debug)]
pub enum SessionMcpLaunchAssemblyError {
    MissingDataKey,
    RestartRequired(String),
    Internal(anyhow::Error),
}

pub fn assemble_session_mcp_launch(
    _cipher: Option<&SessionDataCipher>,
    session_extensions: &[Arc<dyn SessionExtension>],
    product_mcp_launch_catalog: &ProductMcpLaunchCatalog,
    workspace: &WorkspaceRecord,
    record: &SessionRecord,
    persisted_system_prompt_append: Option<String>,
) -> Result<SessionMcpLaunchAssembly, SessionMcpLaunchAssemblyError> {
    let mut mcp_servers = Vec::new();

    let mut launch_extras = resolve_extension_launch_extras(session_extensions, workspace, record)
        .map_err(SessionMcpLaunchAssemblyError::Internal)?;
    let mut product_extras = product_mcp_launch_catalog
        .resolve_launch_extras(workspace, record)
        .map_err(SessionMcpLaunchAssemblyError::Internal)?;
    launch_extras
        .system_prompt_append
        .append(&mut product_extras.system_prompt_append);
    launch_extras
        .first_prompt_system_prompt_append
        .append(&mut product_extras.first_prompt_system_prompt_append);
    launch_extras
        .mcp_servers
        .append(&mut product_extras.mcp_servers);
    launch_extras
        .mcp_binding_summaries
        .append(&mut product_extras.mcp_binding_summaries);
    let first_prompt_system_prompt_append =
        join_system_prompt_append(Some(launch_extras.first_prompt_system_prompt_append));
    let system_prompt_append = merge_system_prompt_append(
        persisted_system_prompt_append,
        launch_extras.system_prompt_append,
    );
    let mcp_binding_summaries_json =
        merge_extension_binding_summaries(record, &launch_extras.mcp_binding_summaries)?;
    mcp_servers.extend(launch_extras.mcp_servers);
    dedupe_mcp_servers(&mut mcp_servers);

    Ok(SessionMcpLaunchAssembly {
        mcp_servers,
        system_prompt_append,
        first_prompt_system_prompt_append,
        mcp_binding_summaries_json,
    })
}

fn dedupe_mcp_servers(servers: &mut Vec<SessionMcpServer>) {
    let mut seen = HashSet::new();
    servers.retain(|server| {
        let key = match server {
            SessionMcpServer::Http(server) => {
                format!("http:{}:{}", server.connection_id, server.server_name)
            }
            SessionMcpServer::Stdio(server) => {
                format!("stdio:{}:{}", server.connection_id, server.server_name)
            }
        };
        seen.insert(key)
    });
}

pub(crate) fn join_system_prompt_append(
    system_prompt_append: Option<Vec<String>>,
) -> Option<String> {
    let parts = system_prompt_append?
        .into_iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return None;
    }

    Some(parts.join("\n\n"))
}

fn resolve_extension_launch_extras(
    session_extensions: &[Arc<dyn SessionExtension>],
    workspace: &WorkspaceRecord,
    record: &SessionRecord,
) -> anyhow::Result<SessionLaunchExtras> {
    let ctx = SessionLaunchContext {
        workspace,
        session: record,
    };
    let mut combined = SessionLaunchExtras::default();
    for extension in session_extensions {
        let mut extras = extension.resolve_launch_extras(&ctx)?;
        combined
            .system_prompt_append
            .append(&mut extras.system_prompt_append);
        combined
            .first_prompt_system_prompt_append
            .append(&mut extras.first_prompt_system_prompt_append);
        combined.mcp_servers.append(&mut extras.mcp_servers);
        combined
            .mcp_binding_summaries
            .append(&mut extras.mcp_binding_summaries);
    }
    Ok(combined)
}

fn merge_system_prompt_append(
    persisted: Option<String>,
    extra_lines: Vec<String>,
) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(persisted) = persisted
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        parts.push(persisted);
    }
    if let Some(extra) = join_system_prompt_append(Some(extra_lines)) {
        parts.push(extra);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

fn merge_extension_binding_summaries(
    record: &SessionRecord,
    extension_summaries: &[SessionMcpBindingSummary],
) -> Result<Option<String>, SessionMcpLaunchAssemblyError> {
    if extension_summaries.is_empty() {
        return Ok(None);
    }
    let mut summaries = record
        .to_contract()
        .mcp_binding_summaries
        .unwrap_or_default();
    for summary in extension_summaries {
        if summaries.iter().all(|existing| existing.id != summary.id) {
            summaries.push(summary.clone());
        }
    }
    serialize_binding_summaries(Some(summaries)).map_err(|error| {
        SessionMcpLaunchAssemblyError::Internal(anyhow::anyhow!(
            "serialize MCP binding summaries: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_contract::v1::{SessionMcpBindingOutcome, SessionMcpTransport};

    use crate::domains::sessions::mcp_bindings::crypto::encrypt_bindings;
    use crate::domains::sessions::mcp_bindings::model::{
        SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
    };
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::origin::OriginContext;

    #[derive(Clone)]
    struct StaticExtension {
        extras: SessionLaunchExtras,
    }

    impl SessionExtension for StaticExtension {
        fn resolve_launch_extras(
            &self,
            _ctx: &SessionLaunchContext<'_>,
        ) -> anyhow::Result<SessionLaunchExtras> {
            Ok(self.extras.clone())
        }
    }

    fn sample_cipher() -> SessionDataCipher {
        SessionDataCipher::from_env_value("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
            .expect("cipher")
    }

    fn workspace_record() -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: "repo".to_string(),
            repo_root_id: None,
            path: "/tmp/workspace".to_string(),
            surface: "local".to_string(),
            source_repo_root_path: "/tmp/workspace".to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: None,
            current_branch: None,
            display_name: None,
            origin: Some(OriginContext::api_local_runtime()),
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
        }
    }

    fn session_record() -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_scope: None,
            required_agent_auth_revision: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    fn http_server(id: &str, server_name: &str) -> SessionMcpServer {
        SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: id.to_string(),
            catalog_entry_id: None,
            server_name: server_name.to_string(),
            url: format!("https://{server_name}.example.com/mcp"),
            headers: vec![SessionMcpHeader {
                name: "Authorization".to_string(),
                value: "Bearer secret".to_string(),
            }],
        })
    }

    fn summary(id: &str, server_name: &str) -> SessionMcpBindingSummary {
        SessionMcpBindingSummary {
            id: id.to_string(),
            server_name: server_name.to_string(),
            display_name: Some(server_name.to_string()),
            transport: SessionMcpTransport::Http,
            outcome: SessionMcpBindingOutcome::Applied,
            reason: None,
        }
    }

    #[test]
    fn assemble_launch_ignores_legacy_user_bindings_and_keeps_product_servers() {
        let cipher = sample_cipher();
        let user_server = http_server("user-1", "user");
        let product_server = http_server("product-1", "product");
        let mut record = session_record();
        record.mcp_bindings_ciphertext = Some(
            encrypt_bindings(Some(&cipher), std::slice::from_ref(&user_server))
                .expect("encrypt")
                .expect("ciphertext"),
        );
        let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
            extras: SessionLaunchExtras {
                system_prompt_append: vec!["product prompt".to_string()],
                first_prompt_system_prompt_append: vec!["first prompt".to_string()],
                mcp_servers: vec![product_server],
                mcp_binding_summaries: vec![summary("product-1", "product")],
            },
        });

        let assembled = assemble_session_mcp_launch(
            Some(&cipher),
            &[extension],
            &ProductMcpLaunchCatalog::disabled(),
            &workspace_record(),
            &record,
            Some("persisted prompt".to_string()),
        )
        .expect("assemble launch");

        assert_eq!(assembled.mcp_servers.len(), 1);
        assert!(matches!(
            &assembled.mcp_servers[0],
            SessionMcpServer::Http(server) if server.server_name == "product"
        ));
        assert_eq!(
            assembled.system_prompt_append.as_deref(),
            Some("persisted prompt\n\nproduct prompt")
        );
        assert_eq!(
            assembled.first_prompt_system_prompt_append.as_deref(),
            Some("first prompt")
        );
        assert!(assembled.mcp_binding_summaries_json.is_some());
    }

    #[test]
    fn assemble_launch_skips_user_bindings_for_internal_only_policy() {
        let mut record = session_record();
        record.mcp_binding_policy = SessionMcpBindingPolicy::InternalOnly;
        record.mcp_bindings_ciphertext = Some("v1:not-valid-base64".to_string());
        let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
            extras: SessionLaunchExtras {
                mcp_servers: vec![http_server("product-1", "product")],
                mcp_binding_summaries: vec![summary("product-1", "product")],
                ..SessionLaunchExtras::default()
            },
        });

        let assembled = assemble_session_mcp_launch(
            None,
            &[extension],
            &ProductMcpLaunchCatalog::disabled(),
            &workspace_record(),
            &record,
            None,
        )
        .expect("assemble launch");

        assert_eq!(assembled.mcp_servers.len(), 1);
        assert!(matches!(
            &assembled.mcp_servers[0],
            SessionMcpServer::Http(server) if server.server_name == "product"
        ));
        let summaries: Vec<SessionMcpBindingSummary> =
            serde_json::from_str(&assembled.mcp_binding_summaries_json.expect("summaries"))
                .expect("parse summaries");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "product-1");
    }

    #[test]
    fn assemble_launch_ignores_corrupt_legacy_user_bindings() {
        let mut record = session_record();
        record.mcp_bindings_ciphertext = Some("v1:not-valid-base64".to_string());

        let assembled = assemble_session_mcp_launch(
            Some(&sample_cipher()),
            &[],
            &ProductMcpLaunchCatalog::disabled(),
            &workspace_record(),
            &record,
            None,
        )
        .expect("assemble launch");

        assert!(assembled.mcp_servers.is_empty());
    }

    #[test]
    fn assemble_launch_dedupes_extension_binding_summaries_by_id() {
        let mut record = session_record();
        record.mcp_binding_summaries_json =
            serde_json::to_string(&vec![summary("product-1", "product")]).ok();
        let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
            extras: SessionLaunchExtras {
                mcp_binding_summaries: vec![summary("product-1", "product")],
                ..SessionLaunchExtras::default()
            },
        });

        let assembled = assemble_session_mcp_launch(
            None,
            &[extension],
            &ProductMcpLaunchCatalog::disabled(),
            &workspace_record(),
            &record,
            None,
        )
        .expect("assemble launch");
        let summaries: Vec<SessionMcpBindingSummary> =
            serde_json::from_str(&assembled.mcp_binding_summaries_json.expect("summaries"))
                .expect("parse summaries");

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "product-1");
    }

    #[test]
    fn assemble_launch_merges_existing_and_extension_binding_summaries_in_order() {
        let mut record = session_record();
        record.mcp_binding_summaries_json =
            serde_json::to_string(&vec![summary("user-1", "user")]).ok();
        let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
            extras: SessionLaunchExtras {
                mcp_binding_summaries: vec![summary("product-1", "product")],
                ..SessionLaunchExtras::default()
            },
        });

        let assembled = assemble_session_mcp_launch(
            None,
            &[extension],
            &ProductMcpLaunchCatalog::disabled(),
            &workspace_record(),
            &record,
            None,
        )
        .expect("assemble launch");
        let summaries: Vec<SessionMcpBindingSummary> =
            serde_json::from_str(&assembled.mcp_binding_summaries_json.expect("summaries"))
                .expect("parse summaries");

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].id, "user-1");
        assert_eq!(summaries[1].id, "product-1");
    }

    #[test]
    fn assemble_launch_rejects_invalid_extension_binding_summary() {
        let mut invalid_summary = summary("product-1", "product");
        invalid_summary.id = "product binding".to_string();
        let extension: Arc<dyn SessionExtension> = Arc::new(StaticExtension {
            extras: SessionLaunchExtras {
                mcp_binding_summaries: vec![invalid_summary],
                ..SessionLaunchExtras::default()
            },
        });

        let error = assemble_session_mcp_launch(
            None,
            &[extension],
            &ProductMcpLaunchCatalog::disabled(),
            &workspace_record(),
            &session_record(),
            None,
        )
        .expect_err("invalid summary");

        assert!(matches!(error, SessionMcpLaunchAssemblyError::Internal(_)));
    }
}
