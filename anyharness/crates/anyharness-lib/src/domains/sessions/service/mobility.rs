use super::SessionService;
use crate::domains::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, SessionBundlePromptAttachment,
    SessionEventRecord, SessionLiveConfigSnapshotRecord, SessionRawNotificationRecord,
    SessionRecord,
};

impl SessionService {
    pub fn import_session_bundle(
        &self,
        workspace_id: &str,
        session: &SessionRecord,
        live_config_snapshot: Option<&SessionLiveConfigSnapshotRecord>,
        pending_config_changes: &[PendingConfigChangeRecord],
        pending_prompts: &[PendingPromptRecord],
        prompt_attachments: &[SessionBundlePromptAttachment],
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

    pub fn relocate_session_for_mobility(&self, session: &SessionRecord) -> anyhow::Result<()> {
        self.session_store.relocate_for_mobility(session)
    }
}
