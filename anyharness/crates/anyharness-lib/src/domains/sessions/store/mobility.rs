use rusqlite::params;

use super::SessionStore;
use crate::domains::sessions::model::SessionRecord;
use crate::origin::encode_origin_json;

impl SessionStore {
    /// Relocates a session row onto `record.workspace_id` in place (the
    /// same-runtime mobility case: the destination reuses a session id that
    /// already lives on this runtime under the archive's source workspace).
    /// `preserve_native` keeps `record.native_session_id` (mobility install
    /// mode `preserve_native_sessions` for a supported agent kind);
    /// otherwise the native id is nulled so the destination starts fresh.
    pub fn relocate_for_mobility(
        &self,
        record: &SessionRecord,
        preserve_native: bool,
    ) -> anyhow::Result<()> {
        let origin_json = encode_origin_json(&record.origin)?;
        let native_session_id = preserve_native
            .then(|| record.native_session_id.clone())
            .flatten();
        self.db.with_tx_anyhow(|conn| {
            let updated = conn.execute(
                "UPDATE sessions
                 SET workspace_id = ?2,
                     native_session_id = ?3,
                     requested_model_id = ?4,
                     current_model_id = ?5,
                     requested_mode_id = ?6,
                     current_mode_id = ?7,
                     title = ?8,
                     thinking_level_id = ?9,
                     thinking_budget_tokens = ?10,
                     status = ?11,
                     updated_at = ?12,
                     last_prompt_at = ?13,
                     closed_at = ?14,
                     dismissed_at = ?15,
                     mcp_bindings_ciphertext = NULL,
                     mcp_binding_summaries_json = NULL,
                     mcp_binding_policy = ?16,
                     system_prompt_append = ?17,
                     subagents_enabled = ?18,
                     action_capabilities_json = ?19,
                     origin_json = ?20
                 WHERE id = ?1",
                params![
                    record.id,
                    record.workspace_id,
                    native_session_id,
                    record.requested_model_id,
                    record.current_model_id,
                    record.requested_mode_id,
                    record.current_mode_id,
                    record.title,
                    record.thinking_level_id,
                    record.thinking_budget_tokens,
                    record.status,
                    record.updated_at,
                    record.last_prompt_at,
                    record.closed_at,
                    record.dismissed_at,
                    record.mcp_binding_policy.as_str(),
                    record.system_prompt_append,
                    if record.subagents_enabled { 1 } else { 0 },
                    record.action_capabilities_json,
                    origin_json,
                ],
            )?;
            if updated == 0 {
                anyhow::bail!("session not found for mobility relocation: {}", record.id);
            }
            Ok::<(), anyhow::Error>(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::model::SessionMcpBindingPolicy;
    use crate::persistence::Db;

    fn seed_workspace(db: &Db, workspace_id: &str, path: &str) {
        let repo_root_id = format!("repo-root-{workspace_id}");
        let now = "2026-03-25T00:00:00Z";
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO repo_roots (
                    id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                    remote_repo_name, remote_url, created_at, updated_at
                 ) VALUES (?1, 'external', ?2, NULL, 'main', NULL, NULL, NULL, NULL, ?3, ?3)",
                params![repo_root_id, path, now],
            )?;
            conn.execute(
                "INSERT INTO workspaces (
                    id, kind, repo_root_id, path, surface, lifecycle_state, cleanup_state,
                    created_at, updated_at
                 ) VALUES (?1, 'worktree', ?2, ?3, 'standard', 'active', 'none', ?4, ?4)",
                params![workspace_id, repo_root_id, path, now],
            )?;
            Ok(())
        })
        .expect("seed workspace and repo root");
    }

    fn relocation_source_record(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-source".to_string()),
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: Some("Source title".to_string()),
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            // Seeded non-empty so the relocation assertions can prove they
            // get cleared: MCP bindings are workspace-local encrypted state
            // and must never survive a mobility relocation.
            mcp_bindings_ciphertext: Some("seed-ciphertext".to_string()),
            mcp_binding_summaries_json: Some("[]".to_string()),
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: None,
        }
    }

    #[test]
    fn relocate_for_mobility_preserves_native_id_and_still_nulls_mcp_fields() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db, "workspace-source", "/tmp/relocate-source");
        seed_workspace(&db, "workspace-dest", "/tmp/relocate-dest");
        let store = SessionStore::new(db.clone());
        store
            .insert(&relocation_source_record("session-1", "workspace-source"))
            .expect("insert source session");

        let relocated = relocation_source_record("session-1", "workspace-dest");
        store
            .relocate_for_mobility(&relocated, true)
            .expect("relocate with preserve_native");

        let stored = store
            .find_by_id("session-1")
            .expect("find relocated session")
            .expect("session exists after relocation");
        assert_eq!(stored.workspace_id, "workspace-dest");
        assert_eq!(
            stored.native_session_id.as_deref(),
            Some("native-source"),
            "preserve_native must keep the native id"
        );
        assert_eq!(stored.mcp_bindings_ciphertext, None);
        assert_eq!(stored.mcp_binding_summaries_json, None);
    }

    #[test]
    fn relocate_for_mobility_nulls_native_id_when_not_preserving() {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db, "workspace-source", "/tmp/relocate-source");
        seed_workspace(&db, "workspace-dest", "/tmp/relocate-dest");
        let store = SessionStore::new(db.clone());
        store
            .insert(&relocation_source_record("session-2", "workspace-source"))
            .expect("insert source session");

        let relocated = relocation_source_record("session-2", "workspace-dest");
        store
            .relocate_for_mobility(&relocated, false)
            .expect("relocate without preserve_native");

        let stored = store
            .find_by_id("session-2")
            .expect("find relocated session")
            .expect("session exists after relocation");
        assert_eq!(stored.workspace_id, "workspace-dest");
        assert_eq!(
            stored.native_session_id, None,
            "fresh_native relocation must null the native id"
        );
        assert_eq!(
            stored.mcp_bindings_ciphertext, None,
            "MCP bindings must always be nulled by relocation, preserve_native or not"
        );
        assert_eq!(stored.mcp_binding_summaries_json, None);
    }
}
