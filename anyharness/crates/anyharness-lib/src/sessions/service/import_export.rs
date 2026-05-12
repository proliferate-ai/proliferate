use crate::domains::mobility::model::MobilityPromptAttachmentData;
use crate::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, SessionEventRecord,
    SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord, SessionRecord,
};

use super::SessionService;

impl SessionService {
    pub fn import_session_bundle(
        &self,
        workspace_id: &str,
        session: &SessionRecord,
        live_config_snapshot: Option<&SessionLiveConfigSnapshotRecord>,
        pending_config_changes: &[PendingConfigChangeRecord],
        pending_prompts: &[PendingPromptRecord],
        prompt_attachments: &[MobilityPromptAttachmentData],
        events: &[SessionEventRecord],
        raw_notifications: &[SessionRawNotificationRecord],
    ) -> anyhow::Result<()> {
        self.workspace_store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
        let mut records = Vec::with_capacity(prompt_attachments.len());
        for attachment in prompt_attachments {
            if let Err(error) = self.attachment_storage.write_new(
                &attachment.record.session_id,
                &attachment.record.attachment_id,
                &attachment.content,
            ) {
                for record in &records {
                    let _ = self.attachment_storage.delete_record(record);
                }
                return Err(error);
            }
            records.push(attachment.record.clone());
        }
        let result = self.session_store.import_bundle(
            session,
            live_config_snapshot,
            pending_config_changes,
            pending_prompts,
            &records,
            events,
            raw_notifications,
        );
        if result.is_err() {
            for record in &records {
                let _ = self.attachment_storage.delete_record(record);
            }
        }
        result
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.session_store.delete_session(session_id)?;
        if let Err(error) = self.attachment_storage.delete_session_dir(session_id) {
            tracing::warn!(
                session_id = %session_id,
                error = %error,
                "failed to delete session prompt attachment directory"
            );
        }
        Ok(())
    }
}
