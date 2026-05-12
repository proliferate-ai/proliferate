use anyharness_contract::v1::{
    ContentPart, PromptAttachmentSource as ContractPromptAttachmentSource,
};
use serde::{Deserialize, Serialize};

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

    pub(super) fn content_part(&self) -> ContentPart {
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

pub(super) fn summarize_blocks(blocks: &[StoredPromptBlock]) -> String {
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
