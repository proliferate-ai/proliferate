use agent_client_protocol as acp;
use anyharness_contract::v1::{
    ContentPart, PromptCapabilities, PromptInputBlock, SessionLiveConfigSnapshot,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::sessions::model::{PromptAttachmentKind, PromptAttachmentRecord, PromptAttachmentState};
use crate::sessions::store::SessionStore;

pub const MAX_PROMPT_BLOCKS: usize = 32;
pub const MAX_ATTACHMENTS_PER_PROMPT: usize = 10;
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_TEXT_RESOURCE_BYTES: usize = 256 * 1024;
pub const MAX_TOTAL_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_RESOURCE_PREVIEW_CHARS: usize = 2_000;

#[derive(Debug, Clone)]
pub struct PromptPayload {
    pub blocks: Vec<StoredPromptBlock>,
    pub text_summary: String,
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
        }
    }

    pub fn from_persisted(blocks_json: Option<&str>, fallback_text: &str) -> Self {
        if let Some(blocks_json) = blocks_json.map(str::trim).filter(|value| !value.is_empty()) {
            match serde_json::from_str::<Vec<StoredPromptBlock>>(blocks_json) {
                Ok(blocks) => {
                    let text_summary = summarize_blocks(&blocks);
                    return Self {
                        blocks,
                        text_summary,
                    };
                }
                Err(error) => {
                    tracing::warn!(error = %error, "invalid pending prompt blocks JSON");
                }
            }
        }
        Self::text(fallback_text.to_string())
    }

    pub fn blocks_json(&self) -> anyhow::Result<Option<String>> {
        if self.blocks.len() == 1
            && matches!(self.blocks.first(), Some(StoredPromptBlock::Text { .. }))
        {
            return Ok(None);
        }
        Ok(Some(serde_json::to_string(&self.blocks)?))
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

    pub fn to_acp_blocks(
        &self,
        store: &SessionStore,
        session_id: &str,
    ) -> Result<Vec<acp::ContentBlock>, PromptValidationError> {
        let mut blocks = Vec::with_capacity(self.blocks.len());
        for block in &self.blocks {
            match block {
                StoredPromptBlock::Text { text } => {
                    blocks.push(acp::ContentBlock::Text(acp::TextContent::new(text.clone())));
                }
                StoredPromptBlock::Image {
                    attachment_id,
                    mime_type,
                    uri,
                    ..
                } => {
                    let attachment = store
                        .find_prompt_attachment(session_id, attachment_id)
                        .map_err(|error| {
                            PromptValidationError::internal(format!(
                                "failed to load image attachment: {error}"
                            ))
                        })?
                        .ok_or_else(|| {
                            PromptValidationError::new(
                                "PROMPT_ATTACHMENT_NOT_FOUND",
                                "image attachment not found",
                            )
                        })?;
                    let image = acp::ImageContent::new(
                        BASE64_STANDARD.encode(&attachment.content),
                        mime_type.clone(),
                    )
                    .uri(uri.clone());
                    blocks.push(acp::ContentBlock::Image(image));
                }
                StoredPromptBlock::Resource {
                    attachment_id: Some(attachment_id),
                    uri,
                    mime_type,
                    ..
                } => {
                    let attachment = store
                        .find_prompt_attachment(session_id, attachment_id)
                        .map_err(|error| {
                            PromptValidationError::internal(format!(
                                "failed to load resource attachment: {error}"
                            ))
                        })?
                        .ok_or_else(|| {
                            PromptValidationError::new(
                                "PROMPT_ATTACHMENT_NOT_FOUND",
                                "resource attachment not found",
                            )
                        })?;
                    let text = String::from_utf8(attachment.content).map_err(|_| {
                        PromptValidationError::new(
                            "PROMPT_UNSUPPORTED_BINARY_RESOURCE",
                            "embedded resources must be UTF-8 text",
                        )
                    })?;
                    let resource = acp::TextResourceContents::new(text, uri.clone())
                        .mime_type(mime_type.clone());
                    blocks.push(acp::ContentBlock::Resource(acp::EmbeddedResource::new(
                        acp::EmbeddedResourceResource::TextResourceContents(resource),
                    )));
                }
                StoredPromptBlock::Resource {
                    attachment_id: None,
                    ..
                } => {
                    return Err(PromptValidationError::new(
                        "PROMPT_ATTACHMENT_NOT_FOUND",
                        "resource attachment not found",
                    ));
                }
                StoredPromptBlock::ResourceLink {
                    uri,
                    name,
                    mime_type,
                    title,
                    description,
                    size,
                } => {
                    let size = size.and_then(|value| i64::try_from(value).ok());
                    let link = acp::ResourceLink::new(name.clone(), uri.clone())
                        .mime_type(mime_type.clone())
                        .title(title.clone())
                        .description(description.clone())
                        .size(size);
                    blocks.push(acp::ContentBlock::ResourceLink(link));
                }
            }
        }
        Ok(blocks)
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
            } => ContentPart::Image {
                attachment_id: attachment_id.clone(),
                mime_type: mime_type.clone(),
                name: name.clone(),
                uri: uri.clone(),
                size: Some(*size),
            },
            Self::Resource {
                attachment_id,
                uri,
                name,
                mime_type,
                size,
                preview,
            } => ContentPart::Resource {
                attachment_id: attachment_id.clone(),
                uri: uri.clone(),
                name: name.clone(),
                mime_type: mime_type.clone(),
                size: Some(*size),
                preview: preview.clone(),
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
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreparedPrompt {
    pub payload: PromptPayload,
    pub attachments: Vec<PromptAttachmentRecord>,
}

impl PreparedPrompt {
    pub fn persist_attachments(&self, store: &SessionStore) -> anyhow::Result<()> {
        for attachment in &self.attachments {
            store.insert_prompt_attachment(attachment)?;
        }
        Ok(())
    }

    pub fn cleanup_attachments(
        &self,
        store: &SessionStore,
        session_id: &str,
    ) -> anyhow::Result<()> {
        let ids = self
            .attachments
            .iter()
            .map(|attachment| attachment.attachment_id.as_str())
            .collect::<Vec<_>>();
        store.delete_prompt_attachments(session_id, &ids)
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

pub fn capabilities_from_acp(capabilities: Option<&acp::PromptCapabilities>) -> PromptCapabilities {
    capabilities
        .map(|capabilities| PromptCapabilities {
            image: capabilities.image,
            audio: capabilities.audio,
            embedded_context: capabilities.embedded_context,
        })
        .unwrap_or_default()
}

pub fn capabilities_from_live_config(
    snapshot: Option<&SessionLiveConfigSnapshot>,
) -> PromptCapabilities {
    snapshot
        .map(|snapshot| snapshot.prompt_capabilities)
        .unwrap_or_default()
}

pub fn prepare_prompt(
    store: &SessionStore,
    session_id: &str,
    blocks: Vec<PromptInputBlock>,
    capabilities: PromptCapabilities,
    state: PromptAttachmentState,
) -> Result<PreparedPrompt, PromptValidationError> {
    if blocks.is_empty() {
        return Err(PromptValidationError::new(
            "EMPTY_PROMPT",
            "prompt must include at least one content block",
        ));
    }
    if blocks.len() > MAX_PROMPT_BLOCKS {
        return Err(PromptValidationError::new(
            "PROMPT_TOO_MANY_BLOCKS",
            format!("prompt cannot include more than {MAX_PROMPT_BLOCKS} blocks"),
        ));
    }

    let mut stored_blocks = Vec::with_capacity(blocks.len());
    let mut attachments = Vec::new();
    let mut total_attachment_bytes = 0usize;
    let mut attachment_count = 0usize;

    for block in blocks {
        match block {
            PromptInputBlock::Text { text } => {
                if !text.is_empty() {
                    stored_blocks.push(StoredPromptBlock::Text { text });
                }
            }
            PromptInputBlock::Image {
                data,
                attachment_id,
                mime_type,
                name,
                uri,
            } => {
                if !capabilities.image {
                    return Err(PromptValidationError::new(
                        "PROMPT_CAPABILITY_DENIED",
                        "agent does not support image prompt blocks",
                    ));
                }
                if !mime_type.starts_with("image/") {
                    return Err(PromptValidationError::new(
                        "PROMPT_UNSUPPORTED_IMAGE",
                        "image prompt blocks must use an image MIME type",
                    ));
                }
                match (data, attachment_id) {
                    (Some(data), None) => {
                        let bytes = BASE64_STANDARD.decode(data).map_err(|_| {
                            PromptValidationError::new(
                                "PROMPT_INVALID_IMAGE",
                                "image data must be base64 encoded",
                            )
                        })?;
                        if bytes.len() > MAX_IMAGE_BYTES {
                            return Err(PromptValidationError::new(
                                "PROMPT_IMAGE_TOO_LARGE",
                                format!(
                                    "image attachments must be {MAX_IMAGE_BYTES} bytes or smaller"
                                ),
                            ));
                        }
                        total_attachment_bytes = checked_total(
                            total_attachment_bytes,
                            bytes.len(),
                            MAX_TOTAL_ATTACHMENT_BYTES,
                        )?;
                        attachment_count = checked_attachment_count(attachment_count + 1)?;
                        let attachment_id = uuid::Uuid::new_v4().to_string();
                        let size = bytes.len() as u64;
                        attachments.push(new_attachment(
                            session_id,
                            attachment_id.clone(),
                            state,
                            PromptAttachmentKind::Image,
                            Some(mime_type.clone()),
                            name.clone(),
                            uri.clone(),
                            bytes,
                        ));
                        stored_blocks.push(StoredPromptBlock::Image {
                            attachment_id,
                            mime_type,
                            name,
                            uri,
                            size,
                        });
                    }
                    (None, Some(attachment_id)) => {
                        let attachment = validate_referenced_attachment(
                            store,
                            session_id,
                            &attachment_id,
                            PromptAttachmentKind::Image,
                        )?;
                        if attachment.mime_type.as_deref() != Some(mime_type.as_str()) {
                            return Err(PromptValidationError::new(
                                "PROMPT_INVALID_ATTACHMENT",
                                "image attachment MIME type does not match the prompt block",
                            ));
                        }
                        let byte_len = attachment.content.len();
                        if byte_len > MAX_IMAGE_BYTES {
                            return Err(PromptValidationError::new(
                                "PROMPT_IMAGE_TOO_LARGE",
                                format!(
                                    "image attachments must be {MAX_IMAGE_BYTES} bytes or smaller"
                                ),
                            ));
                        }
                        total_attachment_bytes = checked_total(
                            total_attachment_bytes,
                            byte_len,
                            MAX_TOTAL_ATTACHMENT_BYTES,
                        )?;
                        attachment_count = checked_attachment_count(attachment_count + 1)?;
                        stored_blocks.push(StoredPromptBlock::Image {
                            attachment_id,
                            mime_type,
                            name,
                            uri,
                            size: byte_len as u64,
                        });
                    }
                    (Some(_), Some(_)) => {
                        return Err(PromptValidationError::new(
                            "PROMPT_INVALID_ATTACHMENT",
                            "image blocks must provide either data or attachmentId, not both",
                        ));
                    }
                    (None, None) => {
                        return Err(PromptValidationError::new(
                            "PROMPT_INVALID_ATTACHMENT",
                            "image blocks require data or attachmentId",
                        ));
                    }
                }
            }
            PromptInputBlock::Resource {
                text,
                attachment_id,
                uri,
                name,
                mime_type,
                size: declared_size,
            } => {
                if !capabilities.embedded_context {
                    return Err(PromptValidationError::new(
                        "PROMPT_CAPABILITY_DENIED",
                        "agent does not support embedded resource prompt blocks",
                    ));
                }
                if uri.trim().is_empty() {
                    return Err(PromptValidationError::new(
                        "PROMPT_INVALID_RESOURCE",
                        "embedded resource URI is required",
                    ));
                }
                match (text, attachment_id) {
                    (Some(text), None) => {
                        let bytes = text.as_bytes().to_vec();
                        if bytes.len() > MAX_TEXT_RESOURCE_BYTES {
                            return Err(PromptValidationError::new(
                                "PROMPT_RESOURCE_TOO_LARGE",
                                format!(
                                    "text resources must be {MAX_TEXT_RESOURCE_BYTES} bytes or smaller"
                                ),
                            ));
                        }
                        total_attachment_bytes = checked_total(
                            total_attachment_bytes,
                            bytes.len(),
                            MAX_TOTAL_ATTACHMENT_BYTES,
                        )?;
                        attachment_count = checked_attachment_count(attachment_count + 1)?;
                        let attachment_id = uuid::Uuid::new_v4().to_string();
                        let size = bytes.len() as u64;
                        let preview = bounded_preview(&text);
                        attachments.push(new_attachment(
                            session_id,
                            attachment_id.clone(),
                            state,
                            PromptAttachmentKind::TextResource,
                            mime_type.clone(),
                            name.clone(),
                            Some(uri.clone()),
                            bytes,
                        ));
                        stored_blocks.push(StoredPromptBlock::Resource {
                            attachment_id: Some(attachment_id),
                            uri,
                            name,
                            mime_type,
                            size,
                            preview,
                        });
                    }
                    (None, Some(attachment_id)) => {
                        let attachment = validate_referenced_attachment(
                            store,
                            session_id,
                            &attachment_id,
                            PromptAttachmentKind::TextResource,
                        )?;
                        let byte_len = attachment.content.len();
                        if byte_len > MAX_TEXT_RESOURCE_BYTES {
                            return Err(PromptValidationError::new(
                                "PROMPT_RESOURCE_TOO_LARGE",
                                format!(
                                    "text resources must be {MAX_TEXT_RESOURCE_BYTES} bytes or smaller"
                                ),
                            ));
                        }
                        total_attachment_bytes = checked_total(
                            total_attachment_bytes,
                            byte_len,
                            MAX_TOTAL_ATTACHMENT_BYTES,
                        )?;
                        attachment_count = checked_attachment_count(attachment_count + 1)?;
                        stored_blocks.push(StoredPromptBlock::Resource {
                            attachment_id: Some(attachment_id),
                            uri,
                            name,
                            mime_type: mime_type.or_else(|| attachment.mime_type.clone()),
                            size: declared_size.unwrap_or(byte_len as u64),
                            preview: None,
                        });
                    }
                    (Some(_), Some(_)) => {
                        return Err(PromptValidationError::new(
                            "PROMPT_INVALID_ATTACHMENT",
                            "resource blocks must provide either text or attachmentId, not both",
                        ));
                    }
                    (None, None) => {
                        return Err(PromptValidationError::new(
                            "PROMPT_INVALID_ATTACHMENT",
                            "resource blocks require text or attachmentId",
                        ));
                    }
                }
            }
            PromptInputBlock::ResourceLink {
                uri,
                name,
                mime_type,
                title,
                description,
                size,
            } => {
                if uri.trim().is_empty() || name.trim().is_empty() {
                    return Err(PromptValidationError::new(
                        "PROMPT_INVALID_RESOURCE_LINK",
                        "resource links require uri and name",
                    ));
                }
                stored_blocks.push(StoredPromptBlock::ResourceLink {
                    uri,
                    name,
                    mime_type,
                    title,
                    description,
                    size,
                });
            }
        }
    }

    let payload = PromptPayload {
        text_summary: summarize_blocks(&stored_blocks),
        blocks: stored_blocks,
    };
    if !payload.has_content() {
        return Err(PromptValidationError::new(
            "EMPTY_PROMPT",
            "prompt must include at least one non-empty content block",
        ));
    }

    Ok(PreparedPrompt {
        payload,
        attachments,
    })
}

fn checked_total(current: usize, next: usize, max: usize) -> Result<usize, PromptValidationError> {
    let total = current.saturating_add(next);
    if total > max {
        return Err(PromptValidationError::new(
            "PROMPT_PAYLOAD_TOO_LARGE",
            format!("prompt attachments must total {max} bytes or less"),
        ));
    }
    Ok(total)
}

fn checked_attachment_count(count: usize) -> Result<usize, PromptValidationError> {
    if count > MAX_ATTACHMENTS_PER_PROMPT {
        return Err(PromptValidationError::new(
            "PROMPT_TOO_MANY_ATTACHMENTS",
            format!("prompt cannot include more than {MAX_ATTACHMENTS_PER_PROMPT} attachments"),
        ));
    }
    Ok(count)
}

fn validate_referenced_attachment(
    store: &SessionStore,
    session_id: &str,
    attachment_id: &str,
    expected_kind: PromptAttachmentKind,
) -> Result<PromptAttachmentRecord, PromptValidationError> {
    let attachment = store
        .find_prompt_attachment(session_id, attachment_id)
        .map_err(|error| {
            PromptValidationError::internal(format!("failed to load prompt attachment: {error}"))
        })?
        .ok_or_else(|| {
            PromptValidationError::new("PROMPT_ATTACHMENT_NOT_FOUND", "prompt attachment not found")
        })?;

    if attachment.kind != expected_kind {
        return Err(PromptValidationError::new(
            "PROMPT_INVALID_ATTACHMENT",
            "prompt attachment kind does not match the prompt block",
        ));
    }

    if attachment.state != PromptAttachmentState::Pending {
        return Err(PromptValidationError::new(
            "PROMPT_INVALID_ATTACHMENT_STATE",
            "prompt attachments can only be referenced while pending",
        ));
    }

    Ok(attachment)
}

fn new_attachment(
    session_id: &str,
    attachment_id: String,
    state: PromptAttachmentState,
    kind: PromptAttachmentKind,
    mime_type: Option<String>,
    display_name: Option<String>,
    source_uri: Option<String>,
    content: Vec<u8>,
) -> PromptAttachmentRecord {
    let now = chrono::Utc::now().to_rfc3339();
    let mut hasher = Sha256::new();
    hasher.update(&content);
    let sha256 = format!("{:x}", hasher.finalize());
    PromptAttachmentRecord {
        attachment_id,
        session_id: session_id.to_string(),
        state,
        kind,
        mime_type,
        display_name,
        source_uri,
        size_bytes: content.len().try_into().unwrap_or(i64::MAX),
        sha256,
        content,
        created_at: now.clone(),
        updated_at: now,
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
        })
        .collect::<Vec<_>>();
    parts.join("\n")
}

fn bounded_preview(text: &str) -> Option<String> {
    let preview = text
        .chars()
        .take(MAX_RESOURCE_PREVIEW_CHARS)
        .collect::<String>();
    (!preview.is_empty()).then_some(preview)
}
