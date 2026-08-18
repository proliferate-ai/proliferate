use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use super::{
    AgentOperations, AgentOperationsError, AgentWorkspaceOperations, AgentWorkspacePinEvents,
};
use crate::domains::agent_operations::model::{
    AgentCapability, CreateWorkspaceInput, CreateWorkspaceResult, ListWorkspacesInput,
    RuntimeIdentity, WorkspaceIdentity, WorkspaceOptionsView, WorkspacePage, WorkspacePinIntent,
    WorkspacePinRequestResult, WorkspacePinRequestStatus, WorkspaceView, MAX_WORKSPACE_PAGE_SIZE,
};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::options::CreateWorkspaceFromOptionsInput;
use crate::origin::OriginContext;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceListCursor {
    created_at: String,
    id: String,
}

impl AgentOperations {
    #[tracing::instrument(skip_all, fields(operation = "list_workspaces"))]
    pub async fn list_workspaces(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        input: ListWorkspacesInput,
    ) -> Result<WorkspacePage, AgentOperationsError> {
        if input.limit == 0 || input.limit > MAX_WORKSPACE_PAGE_SIZE {
            return Err(AgentOperationsError::InvalidWorkspacePageSize);
        }
        self.resolve_caller_agent(caller)?;
        let records = self.workspace_operations()?.list_workspaces().await?;
        let (records, next_cursor) =
            paginate_workspace_records(records, input.cursor, input.limit)?;
        let workspaces = records
            .into_iter()
            .map(|record| project_workspace(&self.runtime_id, record))
            .collect::<Vec<_>>();
        Ok(WorkspacePage {
            workspaces,
            next_cursor,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "list_workspace_options"))]
    pub async fn list_workspace_options(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
    ) -> Result<WorkspaceOptionsView, AgentOperationsError> {
        self.resolve_caller_agent(caller)?;
        let options = self
            .workspace_operations()?
            .list_workspace_options()
            .await?;
        Ok(WorkspaceOptionsView {
            runtime_id: self.runtime_id.clone(),
            options,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "create_workspace"))]
    pub async fn create_workspace(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        input: CreateWorkspaceInput,
    ) -> Result<CreateWorkspaceResult, AgentOperationsError> {
        let caller_agent = self.resolve_caller_agent(caller)?;
        self.assert_caller_capability(&caller_agent, AgentCapability::CreateWorkspace)?;
        let caller_workspace_id = caller_agent.record.workspace_id.clone();
        let created = self
            .workspace_operations()?
            .create_workspace(
                &caller_workspace_id,
                CreateWorkspaceFromOptionsInput {
                    repository_id: input.repository_id,
                    creation_mode: input.creation_mode,
                    branch: input.branch,
                    display_name: input.display_name.clone(),
                    origin: OriginContext::system_local_runtime(),
                    creator_context: WorkspaceCreatorContext::Agent {
                        source_session_id: caller_agent.record.id,
                        source_session_workspace_id: Some(caller_workspace_id.clone()),
                        session_link_id: caller_agent
                            .parent_link
                            .as_ref()
                            .map(|link| link.id.clone()),
                        source_workspace_id: Some(caller_workspace_id.clone()),
                        label: input.display_name,
                    },
                },
            )
            .await?;
        Ok(CreateWorkspaceResult {
            workspace: project_workspace(&self.runtime_id, created.workspace),
            creation_mode: created.creation_mode,
        })
    }

    #[tracing::instrument(skip_all, fields(operation = "request_workspace_pin_state", pinned))]
    pub async fn request_workspace_pin_state(
        &self,
        caller: &crate::domains::agent_operations::model::AuthenticatedAgentCaller,
        workspace: &WorkspaceIdentity,
        pinned: bool,
    ) -> Result<WorkspacePinRequestResult, AgentOperationsError> {
        let caller_agent = self.resolve_caller_agent(caller)?;
        let capability = if pinned {
            AgentCapability::PinWorkspace
        } else {
            AgentCapability::UnpinWorkspace
        };
        self.assert_caller_capability(&caller_agent, capability)?;
        if workspace.runtime_id != self.runtime_id {
            return Err(AgentOperationsError::RuntimeBoundaryDenied);
        }
        let record = self
            .workspace_operations()?
            .get_workspace(&workspace.workspace_id)
            .await?
            .ok_or_else(|| {
                crate::domains::workspaces::options::WorkspaceOptionsError::WorkspaceNotFound(
                    workspace.workspace_id.clone(),
                )
            })?;
        let request_id = uuid::Uuid::new_v4().to_string();
        self.workspace_pin_events()?
            .emit_workspace_pin_intent(
                &caller.identity().session_id,
                WorkspacePinIntent {
                    request_id: request_id.clone(),
                    runtime_id: self.runtime_id.as_str().to_string(),
                    source_session_id: caller.identity().session_id.clone(),
                    workspace_id: record.id.clone(),
                    pinned,
                },
            )
            .await
            .map_err(AgentOperationsError::Internal)?;
        Ok(WorkspacePinRequestResult {
            request_id,
            workspace: project_workspace(&self.runtime_id, record),
            pinned,
            status: WorkspacePinRequestStatus::Requested,
        })
    }

    pub(super) fn workspace_operations(
        &self,
    ) -> Result<&Arc<dyn AgentWorkspaceOperations>, AgentOperationsError> {
        self.workspaces
            .as_ref()
            .ok_or(AgentOperationsError::WorkspaceCatalogsUnavailable)
    }

    fn workspace_pin_events(
        &self,
    ) -> Result<&Arc<dyn AgentWorkspacePinEvents>, AgentOperationsError> {
        self.workspace_pin_events
            .as_ref()
            .ok_or(AgentOperationsError::WorkspacePinEventsUnavailable)
    }
}

fn paginate_workspace_records(
    mut records: Vec<WorkspaceRecord>,
    cursor: Option<String>,
    limit: usize,
) -> Result<(Vec<WorkspaceRecord>, Option<String>), AgentOperationsError> {
    let cursor = cursor.as_deref().map(decode_workspace_cursor).transpose()?;

    // `updated_at` changes during branch refresh and display-name updates, so
    // it cannot participate in a continuation token. Creation time and id are
    // immutable and form a total keyset order even when the owner's source
    // query returns a newly reordered list.
    records.sort_unstable_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    if let Some(cursor) = cursor.as_ref() {
        records.retain(|record| {
            (record.created_at.as_str(), record.id.as_str())
                < (cursor.created_at.as_str(), cursor.id.as_str())
        });
    }

    let mut page = records.into_iter().take(limit + 1).collect::<Vec<_>>();
    let has_more = page.len() > limit;
    page.truncate(limit);
    let next_cursor = has_more
        .then(|| page.last())
        .flatten()
        .map(encode_workspace_cursor)
        .transpose()?;
    Ok((page, next_cursor))
}

fn encode_workspace_cursor(record: &WorkspaceRecord) -> Result<String, AgentOperationsError> {
    let bytes = serde_json::to_vec(&WorkspaceListCursor {
        created_at: record.created_at.clone(),
        id: record.id.clone(),
    })
    .map_err(|error| AgentOperationsError::Internal(error.into()))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_workspace_cursor(cursor: &str) -> Result<WorkspaceListCursor, AgentOperationsError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| AgentOperationsError::InvalidWorkspaceCursor)?;
    let decoded: WorkspaceListCursor =
        serde_json::from_slice(&bytes).map_err(|_| AgentOperationsError::InvalidWorkspaceCursor)?;
    if decoded.id.is_empty() || chrono::DateTime::parse_from_rfc3339(&decoded.created_at).is_err() {
        return Err(AgentOperationsError::InvalidWorkspaceCursor);
    }
    Ok(decoded)
}

fn project_workspace(runtime_id: &RuntimeIdentity, record: WorkspaceRecord) -> WorkspaceView {
    WorkspaceView {
        identity: crate::domains::agent_operations::model::WorkspaceIdentity {
            runtime_id: runtime_id.clone(),
            workspace_id: record.id,
        },
        repository_id: record.repo_root_id,
        kind: record.kind.as_str().to_string(),
        surface: record.surface.as_str().to_string(),
        path: record.path,
        display_name: record.display_name,
        original_branch: record.original_branch,
        current_branch: record.current_branch,
        lifecycle_state: record.lifecycle_state.as_str().to_string(),
        origin: record.origin,
        creator_context: record.creator_context,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::workspaces::model::{
        WorkspaceKind, WorkspaceLifecycleState, WorkspaceSurface,
    };

    fn workspace(id: &str, created_at: &str, updated_at: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Local,
            repo_root_id: "repo-1".to_string(),
            path: format!("/runtime/workspaces/{id}"),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: Some(format!("Workspace {id}")),
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            archived_head_sha: None,
            archived_branch: None,
            archived_at: None,
            partial_capture_json: None,
            created_at: created_at.to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    #[test]
    fn workspace_cursor_is_an_immutable_keyset_across_owner_reordering() {
        let initial = vec![
            workspace(
                "workspace-b",
                "2026-08-11T02:00:00Z",
                "2026-08-11T04:00:00Z",
            ),
            workspace(
                "workspace-d",
                "2026-08-11T04:00:00Z",
                "2026-08-11T01:00:00Z",
            ),
            workspace(
                "workspace-a",
                "2026-08-11T01:00:00Z",
                "2026-08-11T03:00:00Z",
            ),
            workspace(
                "workspace-c",
                "2026-08-11T03:00:00Z",
                "2026-08-11T02:00:00Z",
            ),
        ];
        let (first, cursor) =
            paginate_workspace_records(initial, None, 2).expect("first keyset page");
        assert_eq!(
            first
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["workspace-d", "workspace-c"]
        );

        // Simulate a branch refresh changing updated_at and the owner returning
        // an unrelated order. The cursor row is also absent, proving the
        // continuation does not depend on finding a mutable list position.
        let refreshed = vec![
            workspace(
                "workspace-a",
                "2026-08-11T01:00:00Z",
                "2026-08-12T09:00:00Z",
            ),
            workspace(
                "workspace-d",
                "2026-08-11T04:00:00Z",
                "2026-08-10T01:00:00Z",
            ),
            workspace(
                "workspace-b",
                "2026-08-11T02:00:00Z",
                "2026-08-12T10:00:00Z",
            ),
        ];
        let (second, next) =
            paginate_workspace_records(refreshed, cursor, 2).expect("continuation after refresh");
        assert_eq!(
            second
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["workspace-b", "workspace-a"]
        );
        assert!(next.is_none());

        let all = first
            .into_iter()
            .chain(second)
            .map(|record| record.id)
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(all.len(), 4, "no workspace is skipped or duplicated");
    }

    #[test]
    fn malformed_workspace_cursor_is_typed() {
        for cursor in [
            "not-base64".to_string(),
            URL_SAFE_NO_PAD.encode(br#"{"createdAt":"2026-08-11T00:00:00Z"}"#),
            URL_SAFE_NO_PAD.encode(br#"{"createdAt":"","id":"workspace-a"}"#),
            URL_SAFE_NO_PAD.encode(br#"{"createdAt":"not-a-time","id":"workspace-a"}"#),
        ] {
            assert!(matches!(
                paginate_workspace_records(Vec::new(), Some(cursor), 10),
                Err(AgentOperationsError::InvalidWorkspaceCursor)
            ));
        }
    }

    #[test]
    fn workspace_projection_reuses_durable_origin_and_creator_context_shapes() {
        let mut record = workspace(
            "workspace-agent-created",
            "2026-08-11T00:00:00Z",
            "2026-08-11T00:00:00Z",
        );
        record.origin = Some(OriginContext::system_local_runtime());
        record.creator_context = Some(WorkspaceCreatorContext::Agent {
            source_session_id: "session-parent".to_string(),
            source_session_workspace_id: Some("workspace-parent".to_string()),
            session_link_id: Some("link-child".to_string()),
            source_workspace_id: Some("workspace-parent".to_string()),
            label: Some("Created by agent".to_string()),
        });
        let expected_origin = serde_json::to_value(
            record
                .origin
                .as_ref()
                .expect("durable origin")
                .to_contract(),
        )
        .expect("serialize API origin");
        let expected_creator = serde_json::to_value(
            record
                .creator_context
                .as_ref()
                .expect("durable creator context")
                .to_contract(),
        )
        .expect("serialize API creator context");

        let projected = serde_json::to_value(project_workspace(
            &RuntimeIdentity::new("runtime-1"),
            record,
        ))
        .expect("serialize MCP projection");
        assert_eq!(projected["origin"], expected_origin);
        assert_eq!(projected["creatorContext"], expected_creator);
    }
}
