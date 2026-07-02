use std::time::Instant;

use anyharness_contract::v1::{AgentAuthExternalScope, SessionMcpBindingSummary};

use crate::domains::sessions::mcp_bindings::assembly::join_system_prompt_append;
use crate::domains::sessions::mcp_bindings::crypto::{encrypt_bindings, SessionMcpBindingsError};
use crate::domains::sessions::mcp_bindings::model::SessionMcpServer;
use crate::domains::sessions::mcp_bindings::summaries::{
    serialize_binding_summaries, SessionMcpSummaryError,
};
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::origin::OriginContext;

use super::{CreateAndStartSessionError, SessionRuntime};

impl SessionRuntime {
    #[tracing::instrument(skip_all, fields(workspace_id = %workspace_id, agent_kind = %agent_kind))]
    pub async fn create_and_start_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        system_prompt_append: Option<Vec<String>>,
        mcp_servers: Vec<SessionMcpServer>,
        mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
        subagents_enabled: bool,
        agent_auth_scope: Option<AgentAuthExternalScope>,
        required_agent_auth_revision: Option<i64>,
        origin: OriginContext,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(|error| CreateAndStartSessionError::Invalid(error.to_string()))?;
        let started = Instant::now();
        let system_prompt_append_count = system_prompt_append
            .as_ref()
            .map(|entries| entries.len())
            .unwrap_or(0);
        tracing::info!(
            workspace_id = %workspace_id,
            agent_kind = %agent_kind,
            model_id = ?model_id,
            mode_id = ?mode_id,
            system_prompt_append_count,
            "[workspace-latency] session.runtime.create_and_start.start"
        );
        let durable_create_started = Instant::now();
        let mut record = self.create_durable_session(
            workspace_id,
            agent_kind,
            model_id,
            mode_id,
            system_prompt_append,
            mcp_servers,
            mcp_binding_summaries,
            SessionMcpBindingPolicy::InheritWorkspace,
            subagents_enabled,
            agent_auth_scope,
            required_agent_auth_revision,
            origin,
        )?;
        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            elapsed_ms = durable_create_started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.durable_session_created"
        );
        record = self.start_persisted_session(&record).await?;
        tracing::info!(
            workspace_id = %workspace_id,
            session_id = %record.id,
            native_session_id = %record.native_session_id.as_deref().unwrap_or_default(),
            total_elapsed_ms = started.elapsed().as_millis(),
            "[workspace-latency] session.runtime.create_and_start.completed"
        );

        Ok(record)
    }

    pub fn create_durable_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
        system_prompt_append: Option<Vec<String>>,
        mcp_servers: Vec<SessionMcpServer>,
        mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
        mcp_binding_policy: SessionMcpBindingPolicy,
        subagents_enabled: bool,
        agent_auth_scope: Option<AgentAuthExternalScope>,
        required_agent_auth_revision: Option<i64>,
        origin: OriginContext,
    ) -> Result<SessionRecord, CreateAndStartSessionError> {
        let system_prompt_append = join_system_prompt_append(system_prompt_append);
        let mcp_bindings_ciphertext =
            encrypt_bindings(self.session_data_cipher.as_ref(), &mcp_servers)
                .map_err(map_encrypt_bindings_error_to_create)?;
        let mcp_binding_summaries_json = serialize_binding_summaries(mcp_binding_summaries)
            .map_err(map_mcp_summary_error_to_create)?;
        self.session_service
            .create_session(
                workspace_id,
                agent_kind,
                model_id,
                mode_id,
                mcp_bindings_ciphertext,
                mcp_binding_summaries_json,
                mcp_binding_policy,
                system_prompt_append,
                subagents_enabled,
                agent_auth_scope,
                required_agent_auth_revision,
                origin,
            )
            .map_err(map_create_session_service_error)
    }

    pub async fn has_live_session(&self, session_id: &str) -> bool {
        self.acp_manager.get_handle(session_id).await.is_some()
    }
}

fn map_encrypt_bindings_error_to_create(
    error: SessionMcpBindingsError,
) -> CreateAndStartSessionError {
    match error {
        SessionMcpBindingsError::MissingDataKey => CreateAndStartSessionError::MissingDataKey,
        SessionMcpBindingsError::Encrypt(error) | SessionMcpBindingsError::Decrypt(error) => {
            CreateAndStartSessionError::Internal(error)
        }
    }
}

fn map_mcp_summary_error_to_create(error: SessionMcpSummaryError) -> CreateAndStartSessionError {
    match error {
        SessionMcpSummaryError::Invalid(detail) => CreateAndStartSessionError::Invalid(detail),
        SessionMcpSummaryError::Serialize(error) => CreateAndStartSessionError::Internal(error),
    }
}

fn map_create_session_service_error(
    error: crate::domains::sessions::service::CreateSessionError,
) -> CreateAndStartSessionError {
    match error {
        crate::domains::sessions::service::CreateSessionError::WorkspaceNotFound(_) => {
            CreateAndStartSessionError::WorkspaceNotFound
        }
        crate::domains::sessions::service::CreateSessionError::WorkspaceSingleSession {
            session_id,
            ..
        } => CreateAndStartSessionError::WorkspaceSingleSession { session_id },
        crate::domains::sessions::service::CreateSessionError::ModelUnsupported {
            agent_kind,
            model_id,
        } => CreateAndStartSessionError::ModelUnsupported {
            agent_kind,
            model_id,
        },
        crate::domains::sessions::service::CreateSessionError::ModeUnsupported {
            agent_kind,
            mode_id,
        } => CreateAndStartSessionError::ModeUnsupported {
            agent_kind,
            mode_id,
        },
        crate::domains::sessions::service::CreateSessionError::AgentAuthSelectionRequired(
            required,
        ) => CreateAndStartSessionError::AgentAuthSelectionRequired(required),
        crate::domains::sessions::service::CreateSessionError::Invalid(detail) => {
            CreateAndStartSessionError::Invalid(detail)
        }
        crate::domains::sessions::service::CreateSessionError::Internal(error) => {
            CreateAndStartSessionError::Internal(error)
        }
    }
}
