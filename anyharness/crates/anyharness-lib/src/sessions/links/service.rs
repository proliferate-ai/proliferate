use uuid::Uuid;

use super::model::{SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation};
use super::store::{InsertSubagentLinkOutcome, SessionLinkStore};
use crate::sessions::store::SessionStore;

#[derive(Debug, Clone)]
pub struct CreateSessionLinkInput {
    pub relation: SessionLinkRelation,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub workspace_relation: SessionLinkWorkspaceRelation,
    pub label: Option<String>,
    pub created_by_turn_id: Option<String>,
    pub created_by_tool_call_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CreateSessionLinkError {
    #[error("parent session not found: {0}")]
    ParentNotFound(String),
    #[error("child session not found: {0}")]
    ChildNotFound(String),
    #[error("session cannot be linked to itself")]
    SelfLink,
    #[error("session link already exists")]
    Duplicate,
    #[error("child session already has a subagent parent")]
    ChildAlreadyLinked,
    #[error("parent already has the maximum number of subagents")]
    FanoutLimit,
    #[error(transparent)]
    Store(anyhow::Error),
}

#[derive(Clone)]
pub struct SessionLinkService {
    store: SessionLinkStore,
    session_store: SessionStore,
}

impl SessionLinkService {
    pub fn new(store: SessionLinkStore, session_store: SessionStore) -> Self {
        Self {
            store,
            session_store,
        }
    }

    pub fn create_link(
        &self,
        input: CreateSessionLinkInput,
    ) -> Result<SessionLinkRecord, CreateSessionLinkError> {
        if input.parent_session_id == input.child_session_id {
            return Err(CreateSessionLinkError::SelfLink);
        }
        if self
            .session_store
            .find_by_id(&input.parent_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ParentNotFound(
                input.parent_session_id,
            ));
        }
        if self
            .session_store
            .find_by_id(&input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ChildNotFound(
                input.child_session_id,
            ));
        }
        if input.relation == SessionLinkRelation::Subagent {
            if self
                .store
                .find_subagent_link(&input.parent_session_id, &input.child_session_id)
                .map_err(CreateSessionLinkError::Store)?
                .is_some()
            {
                return Err(CreateSessionLinkError::Duplicate);
            }
            if self
                .store
                .find_subagent_parent(&input.child_session_id)
                .map_err(CreateSessionLinkError::Store)?
                .is_some()
            {
                return Err(CreateSessionLinkError::ChildAlreadyLinked);
            }
        }

        let record = SessionLinkRecord {
            id: Uuid::new_v4().to_string(),
            relation: input.relation,
            parent_session_id: input.parent_session_id,
            child_session_id: input.child_session_id,
            workspace_relation: input.workspace_relation,
            label: input.label,
            created_by_turn_id: input.created_by_turn_id,
            created_by_tool_call_id: input.created_by_tool_call_id,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.store.insert(&record).map_err(|error| {
            if is_unique_constraint_error(&error) {
                CreateSessionLinkError::Duplicate
            } else {
                CreateSessionLinkError::Store(error)
            }
        })?;
        Ok(record)
    }

    pub fn create_subagent_link_with_child_limit(
        &self,
        input: CreateSessionLinkInput,
        max_children: usize,
    ) -> Result<SessionLinkRecord, CreateSessionLinkError> {
        if input.relation != SessionLinkRelation::Subagent {
            return self.create_link(input);
        }
        if input.parent_session_id == input.child_session_id {
            return Err(CreateSessionLinkError::SelfLink);
        }
        if self
            .session_store
            .find_by_id(&input.parent_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ParentNotFound(
                input.parent_session_id,
            ));
        }
        if self
            .session_store
            .find_by_id(&input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_none()
        {
            return Err(CreateSessionLinkError::ChildNotFound(
                input.child_session_id,
            ));
        }
        if self
            .store
            .find_subagent_link(&input.parent_session_id, &input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_some()
        {
            return Err(CreateSessionLinkError::Duplicate);
        }
        if self
            .store
            .find_subagent_parent(&input.child_session_id)
            .map_err(CreateSessionLinkError::Store)?
            .is_some()
        {
            return Err(CreateSessionLinkError::ChildAlreadyLinked);
        }

        let record = SessionLinkRecord {
            id: Uuid::new_v4().to_string(),
            relation: input.relation,
            parent_session_id: input.parent_session_id,
            child_session_id: input.child_session_id,
            workspace_relation: input.workspace_relation,
            label: input.label,
            created_by_turn_id: input.created_by_turn_id,
            created_by_tool_call_id: input.created_by_tool_call_id,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let outcome = self
            .store
            .insert_subagent_with_child_limit(&record, max_children)
            .map_err(|error| {
                if is_unique_constraint_error(&error) {
                    CreateSessionLinkError::Duplicate
                } else {
                    CreateSessionLinkError::Store(error)
                }
            })?;
        match outcome {
            InsertSubagentLinkOutcome::Inserted => Ok(record),
            InsertSubagentLinkOutcome::FanoutLimit => Err(CreateSessionLinkError::FanoutLimit),
        }
    }

    pub fn list_by_parent(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store.list_by_parent(parent_session_id)
    }

    pub fn list_by_child(&self, child_session_id: &str) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store.list_by_child(child_session_id)
    }

    pub fn list_subagent_children(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store.list_subagent_children(parent_session_id)
    }

    pub fn find_subagent_parent(
        &self,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store.find_subagent_parent(child_session_id)
    }

    pub fn find_subagent_link(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store
            .find_subagent_link(parent_session_id, child_session_id)
    }

    pub fn find_link_by_relation(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store
            .find_link_by_relation(relation, parent_session_id, child_session_id)
    }

    pub fn delete_link(&self, id: &str) -> anyhow::Result<bool> {
        self.store.delete_by_id(id)
    }

    pub fn list_children_by_relation(
        &self,
        relation: SessionLinkRelation,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<SessionLinkRecord>> {
        self.store
            .list_children_by_relation(relation, parent_session_id)
    }

    pub fn find_parent_by_relation(
        &self,
        relation: SessionLinkRelation,
        child_session_id: &str,
    ) -> anyhow::Result<Option<SessionLinkRecord>> {
        self.store
            .find_parent_by_relation(relation, child_session_id)
    }

    pub fn import_link(&self, record: &SessionLinkRecord) -> anyhow::Result<()> {
        self.store.import_link(record)
    }
}

fn is_unique_constraint_error(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<rusqlite::Error>()
        .and_then(|inner| match inner {
            rusqlite::Error::SqliteFailure(code, _) => Some(code.extended_code),
            _ => None,
        })
        .is_some_and(|code| code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE)
}

#[cfg(test)]
mod tests {
    use rusqlite::params;

    use super::*;
    use crate::persistence::Db;
    use crate::sessions::model::SessionRecord;

    fn seed_workspace(db: &Db) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");
    }

    fn session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
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
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            origin: None,
        }
    }

    fn service_fixture() -> (Db, SessionStore, SessionLinkService) {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);
        let session_store = SessionStore::new(db.clone());
        session_store
            .insert(&session_record("parent-1"))
            .expect("insert parent");
        session_store
            .insert(&session_record("child-1"))
            .expect("insert child");
        let service =
            SessionLinkService::new(SessionLinkStore::new(db.clone()), session_store.clone());
        (db, session_store, service)
    }

    fn create_input(parent: &str, child: &str) -> CreateSessionLinkInput {
        CreateSessionLinkInput {
            relation: SessionLinkRelation::Subagent,
            parent_session_id: parent.to_string(),
            child_session_id: child.to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: Some("Child".to_string()),
            created_by_turn_id: Some("turn-1".to_string()),
            created_by_tool_call_id: Some("tool-1".to_string()),
        }
    }

    #[test]
    fn creates_and_lists_links_by_parent_and_child() {
        let (_db, _session_store, service) = service_fixture();

        let link = service
            .create_link(create_input("parent-1", "child-1"))
            .expect("create link");

        let by_parent = service.list_by_parent("parent-1").expect("list by parent");
        assert_eq!(by_parent, vec![link.clone()]);
        let by_child = service.list_by_child("child-1").expect("list by child");
        assert_eq!(by_child, vec![link]);
    }

    #[test]
    fn rejects_missing_parent_or_child() {
        let (_db, _session_store, service) = service_fixture();

        let missing_parent = service
            .create_link(create_input("missing-parent", "child-1"))
            .expect_err("missing parent");
        assert!(matches!(
            missing_parent,
            CreateSessionLinkError::ParentNotFound(id) if id == "missing-parent"
        ));

        let missing_child = service
            .create_link(create_input("parent-1", "missing-child"))
            .expect_err("missing child");
        assert!(matches!(
            missing_child,
            CreateSessionLinkError::ChildNotFound(id) if id == "missing-child"
        ));
    }

    #[test]
    fn rejects_self_links_and_duplicates() {
        let (_db, _session_store, service) = service_fixture();

        let self_link = service
            .create_link(create_input("parent-1", "parent-1"))
            .expect_err("self link");
        assert!(matches!(self_link, CreateSessionLinkError::SelfLink));

        service
            .create_link(create_input("parent-1", "child-1"))
            .expect("create first link");
        let duplicate = service
            .create_link(create_input("parent-1", "child-1"))
            .expect_err("duplicate link");
        assert!(matches!(duplicate, CreateSessionLinkError::Duplicate));
    }

    #[test]
    fn rejects_second_subagent_parent_for_same_child() {
        let (_db, session_store, service) = service_fixture();
        session_store
            .insert(&session_record("parent-2"))
            .expect("insert second parent");

        service
            .create_link(create_input("parent-1", "child-1"))
            .expect("create first link");
        let duplicate_parent = service
            .create_link(create_input("parent-2", "child-1"))
            .expect_err("second parent rejected");

        assert!(matches!(
            duplicate_parent,
            CreateSessionLinkError::ChildAlreadyLinked
        ));
    }

    #[test]
    fn create_subagent_link_enforces_child_limit_at_insert() {
        let (_db, session_store, service) = service_fixture();
        session_store
            .insert(&session_record("child-2"))
            .expect("insert second child");

        service
            .create_subagent_link_with_child_limit(create_input("parent-1", "child-1"), 1)
            .expect("create first child link");
        let limit = service
            .create_subagent_link_with_child_limit(create_input("parent-1", "child-2"), 1)
            .expect_err("fanout limit");

        assert!(matches!(limit, CreateSessionLinkError::FanoutLimit));
        assert!(service
            .find_subagent_link("parent-1", "child-2")
            .expect("find second child link")
            .is_none());
    }

    #[test]
    fn rejects_unknown_enum_values_on_read() {
        let (db, _session_store, service) = service_fixture();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_links (
                    id, relation, parent_session_id, child_session_id, workspace_relation,
                    created_at
                 ) VALUES ('bad-relation', 'sidekick', 'parent-1', 'child-1', 'same_workspace', ?1)",
                ["2026-03-25T00:01:00Z"],
            )?;
            Ok(())
        })
        .expect("insert bad relation");
        assert!(service.list_by_parent("parent-1").is_err());

        db.with_conn(|conn| {
            conn.execute("DELETE FROM session_links", [])?;
            conn.execute(
                "INSERT INTO session_links (
                    id, relation, parent_session_id, child_session_id, workspace_relation,
                    created_at
                 ) VALUES ('bad-workspace-relation', 'subagent', 'parent-1', 'child-1', 'new_worktree', ?1)",
                ["2026-03-25T00:01:00Z"],
            )?;
            Ok(())
        })
        .expect("insert bad workspace relation");
        assert!(service.list_by_parent("parent-1").is_err());
    }

    #[test]
    fn delete_session_removes_parent_and_child_links() {
        let (_db, session_store, service) = service_fixture();
        service
            .create_link(create_input("parent-1", "child-1"))
            .expect("create link");

        session_store
            .delete_session("parent-1")
            .expect("delete parent");

        assert!(service
            .list_by_child("child-1")
            .expect("list by child")
            .is_empty());
    }
}
