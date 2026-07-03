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
