use rusqlite::params;

use super::SessionStore;
use crate::origin::encode_origin_json;
use crate::sessions::model::SessionRecord;

impl SessionStore {
    pub fn relocate_for_mobility(&self, record: &SessionRecord) -> anyhow::Result<()> {
        let origin_json = encode_origin_json(&record.origin)?;
        self.db.with_tx_anyhow(|conn| {
            let updated = conn.execute(
                "UPDATE sessions
                 SET workspace_id = ?2,
                     native_session_id = NULL,
                     agent_auth_scope_provider = NULL,
                     agent_auth_scope_id = NULL,
                     agent_auth_scope_target_id = NULL,
                     required_agent_auth_revision = NULL,
                     requested_model_id = ?3,
                     current_model_id = ?4,
                     requested_mode_id = ?5,
                     current_mode_id = ?6,
                     title = ?7,
                     thinking_level_id = ?8,
                     thinking_budget_tokens = ?9,
                     status = ?10,
                     updated_at = ?11,
                     last_prompt_at = ?12,
                     closed_at = ?13,
                     dismissed_at = ?14,
                     mcp_bindings_ciphertext = NULL,
                     mcp_binding_summaries_json = NULL,
                     mcp_binding_policy = ?15,
                     system_prompt_append = ?16,
                     subagents_enabled = ?17,
                     action_capabilities_json = ?18,
                     origin_json = ?19
                 WHERE id = ?1",
                params![
                    record.id,
                    record.workspace_id,
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
