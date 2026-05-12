use anyharness_contract::v1::PromptAttachmentSource as ContractPromptAttachmentSource;
use sha2::{Digest, Sha256};

use crate::sessions::attachment_storage::PromptAttachmentStorage;
use crate::sessions::model::{
    PromptAttachmentKind, PromptAttachmentRecord, PromptAttachmentSource, PromptAttachmentState,
};
use crate::sessions::store::SessionStore;

use super::payload::PromptPayload;
use super::MAX_RESOURCE_PREVIEW_CHARS;

#[derive(Debug, Clone)]
pub struct PreparedPrompt {
    pub payload: PromptPayload,
    pub attachments: Vec<PreparedPromptAttachment>,
}

#[derive(Debug, Clone)]
pub struct PreparedPromptAttachment {
    pub record: PromptAttachmentRecord,
    pub content: Vec<u8>,
}

impl PreparedPrompt {
    pub fn persist_attachments(
        &self,
        store: &SessionStore,
        attachment_storage: &PromptAttachmentStorage,
    ) -> anyhow::Result<()> {
        let mut written = Vec::new();
        for attachment in &self.attachments {
            if let Err(error) = attachment_storage.write_new(
                &attachment.record.session_id,
                &attachment.record.attachment_id,
                &attachment.content,
            ) {
                let ids = written
                    .iter()
                    .map(|record: &PromptAttachmentRecord| record.attachment_id.as_str())
                    .collect::<Vec<_>>();
                let _ = store.delete_prompt_attachments(&attachment.record.session_id, &ids);
                for record in &written {
                    let _ = attachment_storage.delete_record(record);
                }
                return Err(error);
            }
            written.push(attachment.record.clone());
            if let Err(error) = store.insert_prompt_attachment(&attachment.record) {
                let ids = written
                    .iter()
                    .map(|record| record.attachment_id.as_str())
                    .collect::<Vec<_>>();
                let _ = store.delete_prompt_attachments(&attachment.record.session_id, &ids);
                for record in &written {
                    let _ = attachment_storage.delete_record(record);
                }
                return Err(error);
            }
        }
        Ok(())
    }

    pub fn cleanup_attachments(
        &self,
        store: &SessionStore,
        attachment_storage: &PromptAttachmentStorage,
        session_id: &str,
    ) -> anyhow::Result<()> {
        let ids = self
            .attachments
            .iter()
            .map(|attachment| attachment.record.attachment_id.as_str())
            .collect::<Vec<_>>();
        store.delete_prompt_attachments(session_id, &ids)?;
        for attachment in &self.attachments {
            let _ = attachment_storage.delete_record(&attachment.record);
        }
        Ok(())
    }
}

pub(super) fn new_attachment(
    attachment_storage: &PromptAttachmentStorage,
    session_id: &str,
    attachment_id: String,
    state: PromptAttachmentState,
    kind: PromptAttachmentKind,
    source: PromptAttachmentSource,
    mime_type: Option<String>,
    display_name: Option<String>,
    source_uri: Option<String>,
    content: Vec<u8>,
) -> PreparedPromptAttachment {
    let now = chrono::Utc::now().to_rfc3339();
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let sha256 = format!("{:x}", hasher.finalize());
    let storage_path = attachment_storage.storage_path(session_id, &attachment_id);
    let record = PromptAttachmentRecord {
        attachment_id: attachment_id.clone(),
        session_id: session_id.to_string(),
        state,
        kind,
        source,
        mime_type,
        display_name,
        source_uri,
        storage_path,
        size_bytes: content.len().try_into().unwrap_or(i64::MAX),
        sha256,
        created_at: now.clone(),
        updated_at: now,
    };
    PreparedPromptAttachment { record, content }
}

pub(super) fn prompt_attachment_source(
    source: Option<ContractPromptAttachmentSource>,
) -> PromptAttachmentSource {
    match source {
        Some(ContractPromptAttachmentSource::Paste) => PromptAttachmentSource::Paste,
        _ => PromptAttachmentSource::Upload,
    }
}

pub(super) fn managed_attachment_uri(session_id: &str, attachment_id: &str) -> String {
    format!("anyharness-attachment://sessions/{session_id}/attachments/{attachment_id}")
}

pub(super) fn bounded_preview(text: &str) -> Option<String> {
    let preview = text
        .chars()
        .take(MAX_RESOURCE_PREVIEW_CHARS)
        .collect::<String>();
    (!preview.is_empty()).then_some(preview)
}

impl PromptAttachmentSource {
    pub(super) fn into_contract(self) -> ContractPromptAttachmentSource {
        match self {
            PromptAttachmentSource::Upload => ContractPromptAttachmentSource::Upload,
            PromptAttachmentSource::Paste => ContractPromptAttachmentSource::Paste,
        }
    }
}
