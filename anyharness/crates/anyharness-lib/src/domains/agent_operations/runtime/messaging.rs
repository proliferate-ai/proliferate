use std::sync::Arc;

use crate::domains::agent_operations::model::{
    AgentCapability, AuthenticatedAgentCaller, SendMessageInput, SendMessageReceipt,
    SendMessageStatus,
};
use crate::domains::sessions::admission::SessionMutationKind;
use crate::domains::sessions::prompt::provenance::AgentSessionPromptSource;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;

use super::{
    ordinary::caller_provenance_label, AgentMessageQueue, AgentOperations, AgentOperationsError,
};

impl AgentOperations {
    #[tracing::instrument(skip_all, fields(operation = "send_message"))]
    pub async fn send_message(
        &self,
        caller: &AuthenticatedAgentCaller,
        input: SendMessageInput,
    ) -> Result<SendMessageReceipt, AgentOperationsError> {
        let (_, initial_target) =
            self.authorize_target(caller, &input.target, AgentCapability::SendMessage)?;
        if input.message.trim().is_empty() {
            return Err(AgentOperationsError::InvalidMessage);
        }
        let target_workspace_id = initial_target.record.workspace_id.clone();

        let _permit = self
            .admit_target(&input.target.session_id, SessionMutationKind::Prompt)
            .await?;
        let _lease = self
            .operation_gate()?
            .acquire_shared(&target_workspace_id, WorkspaceOperationKind::SessionPrompt)
            .await;

        let (current_caller, current_target) =
            self.authorize_target(caller, &input.target, AgentCapability::SendMessage)?;
        self.assert_target_workspace_under_lease(&current_target, &target_workspace_id)
            .await?;

        let source = AgentSessionPromptSource {
            source_session_id: current_caller.record.id.clone(),
            session_link_id: current_target
                .parent_link
                .as_ref()
                .filter(|link| link.parent_session_id == current_caller.record.id)
                .map(|link| link.id.clone()),
            label: caller_provenance_label(&current_caller.record),
        };
        let queue_seq = self
            .message_queue()?
            .enqueue_agent_message(&current_target.record.id, input.message, source)
            .await
            .map_err(AgentOperationsError::SendMessage)?;

        Ok(SendMessageReceipt {
            target: input.target,
            queue_seq,
            status: SendMessageStatus::DurablyQueued,
        })
    }

    fn message_queue(&self) -> Result<&Arc<dyn AgentMessageQueue>, AgentOperationsError> {
        self.message_queue
            .as_ref()
            .ok_or(AgentOperationsError::MessagingUnavailable)
    }
}
