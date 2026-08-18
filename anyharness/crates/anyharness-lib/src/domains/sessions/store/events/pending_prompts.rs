use super::super::SessionStore;
use crate::domains::sessions::model::PendingPromptRecord;

#[derive(serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PersistedPendingPromptAddedProjection {
    #[serde(rename = "type")]
    event_type: String,
    seq: i64,
    #[serde(default)]
    prompt_id: Option<String>,
    text: String,
    #[serde(default)]
    content_parts: Vec<serde_json::Value>,
    queued_at: String,
    #[serde(default)]
    prompt_provenance: Option<serde_json::Value>,
}

impl SessionStore {
    pub(crate) fn has_pending_prompt_added_event(
        &self,
        pending_prompt: &PendingPromptRecord,
    ) -> anyhow::Result<bool> {
        let payload = pending_prompt.prompt_payload();
        let current = PersistedPendingPromptAddedProjection {
            event_type: "pending_prompt_added".to_string(),
            seq: pending_prompt.seq,
            prompt_id: pending_prompt.prompt_id.clone(),
            text: pending_prompt.text.clone(),
            content_parts: payload
                .content_parts()
                .into_iter()
                .map(serde_json::to_value)
                .collect::<Result<_, _>>()?,
            queued_at: pending_prompt.queued_at.clone(),
            prompt_provenance: payload
                .public_provenance()
                .map(serde_json::to_value)
                .transpose()?,
        };
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT payload_json FROM session_events
                 WHERE session_id = ?1 AND event_type = 'pending_prompt_added'",
            )?;
            let payloads = stmt.query_map([pending_prompt.session_id.as_str()], |row| {
                row.get::<_, String>(0)
            })?;
            for payload in payloads {
                let Ok(added) =
                    serde_json::from_str::<PersistedPendingPromptAddedProjection>(&payload?)
                else {
                    continue;
                };
                if added == current {
                    return Ok(true);
                }
            }
            Ok(false)
        })
    }
}
