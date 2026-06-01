use anyharness_contract::v1::{
    ContentPart, PromptAttachmentSource as ContractPromptAttachmentSource, PromptCapabilities,
    PromptProvenance as PublicPromptProvenance,
};
use serde::{Deserialize, Serialize};

use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::model::{PromptAttachmentRecord, PromptAttachmentState};
use crate::domains::sessions::plan_references::PlanReferenceResolver;
use crate::domains::sessions::store::SessionStore;

mod acp;
pub(crate) mod capabilities;
pub(crate) mod prepare;
pub(crate) mod provenance;
#[cfg(test)]
mod tests;

use provenance::{decode_prompt_provenance, PromptProvenance};

pub const MAX_PROMPT_BLOCKS: usize = 32;
pub const MAX_ATTACHMENTS_PER_PROMPT: usize = 10;
// Plan references have their own count/byte budget because they resolve to
// trusted markdown snapshots, not uploaded attachment payloads.
pub const MAX_PLAN_REFERENCES_PER_PROMPT: usize = 4;
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_TEXT_RESOURCE_BYTES: usize = 256 * 1024;
pub const MAX_TOTAL_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_TOTAL_PLAN_REFERENCE_BYTES: usize = 512 * 1024;
pub const MAX_RESOURCE_PREVIEW_CHARS: usize = 2_000;

pub struct PromptPrepareContext<'a> {
    pub store: &'a SessionStore,
    pub attachment_storage: &'a PromptAttachmentStorage,
    pub session_id: &'a str,
    pub workspace_id: &'a str,
    pub capabilities: PromptCapabilities,
    pub attachment_state: PromptAttachmentState,
    pub plan_resolver: &'a dyn PlanReferenceResolver,
}

#[derive(Debug, Clone)]
pub struct PromptPayload {
    pub blocks: Vec<StoredPromptBlock>,
    pub text_summary: String,
    pub(crate) provenance: Option<PromptProvenance>,
}

impl PromptPayload {
    pub fn text(text: String) -> Self {
        let text_summary = text.trim().to_string();
        let blocks = if text.is_empty() {
            Vec::new()
        } else {
            vec![StoredPromptBlock::Text { text }]
        };
        Self {
            blocks,
            text_summary,
            provenance: None,
        }
    }

    pub fn from_persisted(
        blocks_json: Option<&str>,
        fallback_text: &str,
        provenance_json: Option<&str>,
    ) -> Self {
        let provenance = decode_prompt_provenance(provenance_json);
        if let Some(blocks_json) = blocks_json.map(str::trim).filter(|value| !value.is_empty()) {
            match serde_json::from_str::<Vec<StoredPromptBlock>>(blocks_json) {
                Ok(blocks) => {
                    let text_summary = summarize_blocks(&blocks);
                    return Self {
                        blocks,
                        text_summary,
                        provenance,
                    };
                }
                Err(error) => {
                    tracing::warn!(error = %error, "invalid pending prompt blocks JSON");
                }
            }
        }
        let mut payload = Self::text(fallback_text.to_string());
        payload.provenance = provenance;
        payload
    }

    pub fn blocks_json(&self) -> anyhow::Result<Option<String>> {
        if self.blocks.len() == 1
            && matches!(self.blocks.first(), Some(StoredPromptBlock::Text { .. }))
        {
            return Ok(None);
        }
        Ok(Some(serde_json::to_string(&self.blocks)?))
    }

    pub fn provenance_json(&self) -> anyhow::Result<Option<String>> {
        self.provenance
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(anyhow::Error::from)
    }

    pub fn public_provenance(&self) -> Option<PublicPromptProvenance> {
        self.provenance
            .as_ref()
            .and_then(PromptProvenance::to_public)
    }

    pub(crate) fn with_provenance(mut self, provenance: PromptProvenance) -> Self {
        self.provenance = Some(provenance);
        self
    }

    pub fn content_parts(&self) -> Vec<ContentPart> {
        self.blocks
            .iter()
            .map(StoredPromptBlock::content_part)
            .collect()
    }

    pub fn attachment_ids(&self) -> Vec<String> {
        self.blocks
            .iter()
            .filter_map(StoredPromptBlock::attachment_id)
            .map(ToString::to_string)
            .collect()
    }

    pub fn has_content(&self) -> bool {
        self.blocks.iter().any(|block| match block {
            StoredPromptBlock::Text { text } => !text.trim().is_empty(),
            _ => true,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StoredPromptBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        #[serde(rename = "attachmentId")]
        attachment_id: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
        size: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<ContractPromptAttachmentSource>,
    },
    #[serde(rename = "resource")]
    Resource {
        #[serde(rename = "attachmentId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        attachment_id: Option<String>,
        uri: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(rename = "mimeType")]
        #[serde(skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        size: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<ContractPromptAttachmentSource>,
    },
    #[serde(rename = "resource_link")]
    ResourceLink {
        uri: String,
        name: String,
        #[serde(rename = "mimeType")]
        #[serde(skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<u64>,
    },
    #[serde(rename = "plan_reference")]
    PlanReference {
        #[serde(rename = "planId")]
        plan_id: String,
        title: String,
        #[serde(rename = "bodyMarkdown")]
        body_markdown: String,
        #[serde(rename = "snapshotHash")]
        snapshot_hash: String,
        #[serde(rename = "sourceSessionId")]
        source_session_id: String,
        #[serde(rename = "sourceTurnId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_turn_id: Option<String>,
        #[serde(rename = "sourceItemId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_item_id: Option<String>,
        #[serde(rename = "sourceKind")]
        source_kind: String,
        #[serde(rename = "sourceToolCallId")]
        #[serde(skip_serializing_if = "Option::is_none")]
        source_tool_call_id: Option<String>,
        #[serde(rename = "asResource")]
        as_resource: bool,
    },
}

impl StoredPromptBlock {
    pub fn attachment_id(&self) -> Option<&str> {
        match self {
            Self::Image { attachment_id, .. } => Some(attachment_id),
            Self::Resource {
                attachment_id: Some(attachment_id),
                ..
            } => Some(attachment_id),
            _ => None,
        }
    }

    fn content_part(&self) -> ContentPart {
        match self {
            Self::Text { text } => ContentPart::Text { text: text.clone() },
            Self::Image {
                attachment_id,
                mime_type,
                name,
                uri,
                size,
                source,
            } => ContentPart::Image {
                attachment_id: attachment_id.clone(),
                mime_type: mime_type.clone(),
                name: name.clone(),
                uri: uri.clone(),
                size: Some(*size),
                source: *source,
            },
            Self::Resource {
                attachment_id,
                uri,
                name,
                mime_type,
                size,
                preview,
                source,
            } => ContentPart::Resource {
                attachment_id: attachment_id.clone(),
                uri: uri.clone(),
                name: name.clone(),
                mime_type: mime_type.clone(),
                size: Some(*size),
                preview: preview.clone(),
                preview_truncated: None,
                preview_original_bytes: None,
                source: *source,
            },
            Self::ResourceLink {
                uri,
                name,
                mime_type,
                title,
                description,
                size,
            } => ContentPart::ResourceLink {
                uri: uri.clone(),
                name: name.clone(),
                mime_type: mime_type.clone(),
                title: title.clone(),
                description: description.clone(),
                size: *size,
            },
            Self::PlanReference {
                plan_id,
                title,
                body_markdown,
                snapshot_hash,
                source_session_id,
                source_turn_id,
                source_item_id,
                source_kind,
                source_tool_call_id,
                ..
            } => ContentPart::PlanReference {
                plan_id: plan_id.clone(),
                title: title.clone(),
                body_markdown: body_markdown.clone(),
                snapshot_hash: snapshot_hash.clone(),
                source_session_id: source_session_id.clone(),
                source_turn_id: source_turn_id.clone(),
                source_item_id: source_item_id.clone(),
                source_kind: source_kind.clone(),
                source_tool_call_id: source_tool_call_id.clone(),
            },
        }
    }
}

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

#[derive(Debug, Clone)]
pub struct PromptValidationError {
    pub code: &'static str,
    pub detail: String,
}

impl PromptValidationError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new("PROMPT_INTERNAL_ERROR", detail)
    }
}

fn summarize_blocks(blocks: &[StoredPromptBlock]) -> String {
    let parts = blocks
        .iter()
        .filter_map(|block| match block {
            StoredPromptBlock::Text { text } => {
                let text = text.trim();
                (!text.is_empty()).then(|| text.to_string())
            }
            StoredPromptBlock::Image { name, .. } => Some(match name {
                Some(name) if !name.trim().is_empty() => format!("[image: {name}]"),
                _ => "[image]".to_string(),
            }),
            StoredPromptBlock::Resource { name, uri, .. } => Some(match name {
                Some(name) if !name.trim().is_empty() => format!("[file: {name}]"),
                _ => format!("[file: {uri}]"),
            }),
            StoredPromptBlock::ResourceLink { name, .. } => Some(format!("[link: {name}]")),
            StoredPromptBlock::PlanReference { title, .. } => {
                let title = title.trim();
                Some(if title.is_empty() {
                    "[plan]".to_string()
                } else {
                    format!("[plan: {title}]")
                })
            }
        })
        .collect::<Vec<_>>();
    parts.join("\n")
}
