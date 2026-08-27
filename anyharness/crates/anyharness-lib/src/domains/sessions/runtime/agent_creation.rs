use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::{
    CreateSessionLinkError, CreateSessionLinkInput, CreateSubagentSessionAndLinkError,
};
use crate::domains::sessions::mcp_bindings::crypto::encrypt_bindings;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::workspaces::access_gate::WorkspaceAccessError;
use crate::origin::OriginContext;
use std::collections::BTreeMap;

use super::creation::{map_create_session_service_error, map_encrypt_bindings_error_to_create};
use super::{CreateAndStartSessionError, SessionRuntime};

#[derive(Debug)]
pub enum CreateOrdinaryAgentSessionError {
    Access(WorkspaceAccessError),
    Create(CreateAndStartSessionError),
    InitialTask(super::SendPromptError),
    Cleanup(anyhow::Error),
}

#[derive(Debug)]
pub enum CreateSubagentAgentSessionError {
    Access(WorkspaceAccessError),
    Create(CreateAndStartSessionError),
    Relationship(CreateSessionLinkError),
    InitialTask(super::SendPromptError),
    Cleanup(anyhow::Error),
}

const MAX_ACTIVE_SUBAGENTS_PER_PARENT: usize = 8;

enum StartNewAgentSessionError {
    Start(CreateAndStartSessionError),
    InitialTask(super::SendPromptError),
    Cleanup(anyhow::Error),
}

impl SessionRuntime {
    /// Create one unlinked ordinary agent and optionally submit its initial
    /// task through the existing prompt owner. A verified start or prompt
    /// failure compensates only this freshly minted session.
    pub async fn create_ordinary_agent_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        control_values: &BTreeMap<String, String>,
        task: Option<String>,
        source_session_id: String,
        source_label: String,
    ) -> Result<SessionRecord, CreateOrdinaryAgentSessionError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(CreateOrdinaryAgentSessionError::Access)?;
        self.assert_workspace_checkout_present(workspace_id)
            .map_err(CreateOrdinaryAgentSessionError::Create)?;
        let record = self
            .create_durable_session(
                workspace_id,
                agent_kind,
                None,
                model_id,
                control_values,
                None,
                vec![],
                None,
                SessionMcpBindingPolicy::InheritWorkspace,
                true,
                OriginContext::system_local_runtime(),
            )
            .map_err(CreateOrdinaryAgentSessionError::Create)?;

        self.start_new_agent_session(
            record,
            task,
            PromptProvenance::AgentSession {
                source_session_id,
                session_link_id: None,
                label: Some(source_label),
            },
        )
        .await
        .map_err(map_ordinary_start_error)
    }

    /// Create and start a same-workspace subagent through the same durable
    /// session/start/prompt path as an ordinary agent, adding only its capped
    /// relationship and linked prompt provenance.
    pub async fn create_subagent_agent_session(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        control_values: &BTreeMap<String, String>,
        task: String,
        parent_session_id: &str,
        source_label: &str,
    ) -> Result<SessionRecord, CreateSubagentAgentSessionError> {
        let (record, link) = self.create_durable_subagent_session_and_link(
            workspace_id,
            agent_kind,
            model_id,
            control_values,
            parent_session_id,
            None,
        )?;

        self.start_new_agent_session(
            record,
            Some(task),
            PromptProvenance::AgentSession {
                source_session_id: parent_session_id.to_string(),
                session_link_id: Some(link.id),
                label: Some(source_label.to_string()),
            },
        )
        .await
        .map_err(map_subagent_start_error)
    }

    /// Atomically make the durable child and its capped same-workspace
    /// relationship visible before Workspace `create_agent` starts it.
    pub(crate) fn create_durable_subagent_session_and_link(
        &self,
        workspace_id: &str,
        agent_kind: &str,
        model_id: Option<&str>,
        control_values: &BTreeMap<String, String>,
        parent_session_id: &str,
        link_label: Option<String>,
    ) -> Result<(SessionRecord, SessionLinkRecord), CreateSubagentAgentSessionError> {
        self.access_gate
            .assert_can_mutate_for_workspace(workspace_id)
            .map_err(CreateSubagentAgentSessionError::Access)?;
        self.assert_workspace_checkout_present(workspace_id)
            .map_err(CreateSubagentAgentSessionError::Create)?;
        let Some(parent) = self
            .session_service
            .get_session(parent_session_id)
            .map_err(CreateSubagentAgentSessionError::Cleanup)?
        else {
            return Err(CreateSubagentAgentSessionError::Relationship(
                CreateSessionLinkError::ParentNotFound(parent_session_id.to_string()),
            ));
        };
        if parent.workspace_id != workspace_id {
            return Err(CreateSubagentAgentSessionError::Relationship(
                CreateSessionLinkError::Store(anyhow::anyhow!(
                    "subagent parent and child workspace must match"
                )),
            ));
        }

        let mcp_bindings_ciphertext = encrypt_bindings(self.session_data_cipher.as_ref(), &[])
            .map_err(map_encrypt_bindings_error_to_create)
            .map_err(CreateSubagentAgentSessionError::Create)?;
        let mut created_link = None;
        let outcome = self.session_service.create_session_with_persist(
            workspace_id,
            agent_kind,
            None,
            false,
            model_id,
            control_values,
            mcp_bindings_ciphertext,
            None,
            SessionMcpBindingPolicy::InheritWorkspace,
            None,
            false,
            OriginContext::system_local_runtime(),
            |record, intent, basis_revision, selection| {
                let (link, validated_state) = self
                    .session_link_service
                    .create_subagent_session_and_link_with_child_limit(
                        record,
                        intent,
                        CreateSessionLinkInput {
                            relation: SessionLinkRelation::Subagent,
                            parent_session_id: parent_session_id.to_string(),
                            child_session_id: record.id.clone(),
                            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
                            label: link_label.clone(),
                            created_by_turn_id: None,
                            created_by_tool_call_id: None,
                        },
                        MAX_ACTIVE_SUBAGENTS_PER_PARENT,
                        agent_kind,
                        basis_revision,
                        selection,
                    )
                    .map_err(|error| match error {
                        CreateSubagentSessionAndLinkError::LaunchSelection(unsupported) => {
                            crate::domains::sessions::service::create::map_selection_unsupported(
                                workspace_id,
                                None,
                                agent_kind,
                                unsupported,
                            )
                        }
                        CreateSubagentSessionAndLinkError::Link(error) => {
                            crate::domains::sessions::service::CreateSessionError::Internal(
                                anyhow::Error::new(error),
                            )
                        }
                    })?;
                created_link = Some(link);
                Ok(validated_state)
            },
        );
        let record = match outcome {
            Ok(outcome) => outcome.into_record(),
            Err(crate::domains::sessions::service::CreateSessionError::Internal(error)) => {
                match error.downcast::<CreateSessionLinkError>() {
                    Ok(error) => {
                        return Err(CreateSubagentAgentSessionError::Relationship(error));
                    }
                    Err(error) => {
                        return Err(CreateSubagentAgentSessionError::Create(
                            map_create_session_service_error(
                                crate::domains::sessions::service::CreateSessionError::Internal(
                                    error,
                                ),
                            ),
                        ));
                    }
                }
            }
            Err(error) => {
                return Err(CreateSubagentAgentSessionError::Create(
                    map_create_session_service_error(error),
                ));
            }
        };
        Ok((
            record,
            created_link.expect("successful atomic child creation must return its link"),
        ))
    }

    async fn start_new_agent_session(
        &self,
        record: SessionRecord,
        task: Option<String>,
        provenance: PromptProvenance,
    ) -> Result<SessionRecord, StartNewAgentSessionError> {
        let started = match self.start_persisted_session(&record).await {
            Ok(started) => started,
            Err(error) => {
                self.compensate_new_agent_session(&record.id)
                    .await
                    .map_err(StartNewAgentSessionError::Cleanup)?;
                return Err(StartNewAgentSessionError::Start(error));
            }
        };
        let Some(task) = task else {
            return Ok(started);
        };
        match self
            .send_text_prompt_with_id_and_provenance_under_workspace_lease(
                &record.workspace_id,
                &record.id,
                task,
                format!("agent-create-{}", uuid::Uuid::new_v4()),
                provenance,
            )
            .await
        {
            Ok(super::SendPromptOutcome::Running { session, .. })
            | Ok(super::SendPromptOutcome::Queued { session, .. }) => Ok(session),
            Err(super::TextPromptDispatchError::AcknowledgementLost) => self
                .session_service
                .get_session(&record.id)
                .map_err(StartNewAgentSessionError::Cleanup)
                .map(|current| current.unwrap_or(started)),
            Err(super::TextPromptDispatchError::Dispatch(error)) => {
                self.compensate_new_agent_session(&record.id)
                    .await
                    .map_err(StartNewAgentSessionError::Cleanup)?;
                Err(StartNewAgentSessionError::InitialTask(error))
            }
        }
    }

    #[cfg(test)]
    pub(super) async fn start_new_ordinary_agent_session(
        &self,
        record: SessionRecord,
        task: Option<String>,
        source_session_id: String,
        source_label: String,
    ) -> Result<SessionRecord, CreateOrdinaryAgentSessionError> {
        self.start_new_agent_session(
            record,
            task,
            PromptProvenance::AgentSession {
                source_session_id,
                session_link_id: None,
                label: Some(source_label),
            },
        )
        .await
        .map_err(map_ordinary_start_error)
    }

    /// Close and delete one freshly minted session that failed to start or to
    /// take its first prompt. Shared with the workflow engine's node launch,
    /// which compensates a half-born session through the same steps.
    pub(crate) async fn compensate_new_agent_session(
        &self,
        session_id: &str,
    ) -> anyhow::Result<()> {
        if let Some(handle) = self.acp_manager.get_handle(session_id).await {
            let _ = handle.close().await;
        }
        self.acp_manager.remove_session(session_id).await;
        self.session_service.delete_session(session_id)
    }
}

fn map_ordinary_start_error(error: StartNewAgentSessionError) -> CreateOrdinaryAgentSessionError {
    match error {
        StartNewAgentSessionError::Start(error) => CreateOrdinaryAgentSessionError::Create(error),
        StartNewAgentSessionError::InitialTask(error) => {
            CreateOrdinaryAgentSessionError::InitialTask(error)
        }
        StartNewAgentSessionError::Cleanup(error) => {
            CreateOrdinaryAgentSessionError::Cleanup(error)
        }
    }
}

fn map_subagent_start_error(error: StartNewAgentSessionError) -> CreateSubagentAgentSessionError {
    match error {
        StartNewAgentSessionError::Start(error) => CreateSubagentAgentSessionError::Create(error),
        StartNewAgentSessionError::InitialTask(error) => {
            CreateSubagentAgentSessionError::InitialTask(error)
        }
        StartNewAgentSessionError::Cleanup(error) => {
            CreateSubagentAgentSessionError::Cleanup(error)
        }
    }
}

#[cfg(test)]
#[path = "ordinary_creation_tests.rs"]
mod ordinary_creation_tests;
