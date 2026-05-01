use std::collections::HashSet;

use agent_client_protocol as acp;
use anyharness_contract::v1::{
    ContentPart, PromptCapabilities, PromptInputBlock, PromptProvenance as PublicPromptProvenance,
    SessionLiveConfigSnapshot,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::plans::{document, model::PlanRecord};
use crate::sessions::model::{PromptAttachmentKind, PromptAttachmentRecord, PromptAttachmentState};
use crate::sessions::store::SessionStore;

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

pub trait PlanReferenceResolver {
    fn resolve_plan_reference(&self, plan_id: &str) -> anyhow::Result<Option<PlanRecord>>;
}

pub struct PromptPrepareContext<'a> {
    pub store: &'a SessionStore,
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
                StoredPromptBlock::PlanReference {
                    plan_id,
                    title,
                    body_markdown,
                    snapshot_hash,
                    as_resource,
                    ..
                } => {
                    let markdown = document::render_markdown_snapshot(title, body_markdown);
                    if *as_resource {
                        let uri = format!("plan://{plan_id}?snapshot={snapshot_hash}");
                        let resource = acp::TextResourceContents::new(markdown, uri)
                            .mime_type(Some("text/markdown".to_string()));
                        blocks.push(acp::ContentBlock::Resource(acp::EmbeddedResource::new(
                            acp::EmbeddedResourceResource::TextResourceContents(resource),
                        )));
                    } else {
                        blocks.push(acp::ContentBlock::Text(acp::TextContent::new(markdown)));
                    }
                }
            }
        }
        Ok(blocks)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum PromptProvenance {
    #[serde(rename_all = "camelCase")]
    AgentSession {
        source_session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_link_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Automation {
        automation_run_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SubagentWake {
        session_link_id: String,
        completion_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    LinkWake {
        relation: String,
        session_link_id: String,
        completion_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ReviewFeedback {
        review_run_id: String,
        review_round_id: String,
        feedback_job_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    System {
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

impl PromptProvenance {
    pub(crate) fn to_public(&self) -> Option<PublicPromptProvenance> {
        match self {
            PromptProvenance::AgentSession {
                source_session_id,
                session_link_id,
                label,
            } => Some(PublicPromptProvenance::AgentSession {
                source_session_id: source_session_id.clone(),
                session_link_id: session_link_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::SubagentWake {
                session_link_id,
                completion_id,
                label,
            } => Some(PublicPromptProvenance::SubagentWake {
                session_link_id: session_link_id.clone(),
                completion_id: completion_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::LinkWake {
                relation,
                session_link_id,
                completion_id,
                label,
            } => Some(PublicPromptProvenance::LinkWake {
                relation: relation.clone(),
                session_link_id: session_link_id.clone(),
                completion_id: completion_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::ReviewFeedback {
                review_run_id,
                review_round_id,
                feedback_job_id,
                label,
            } => Some(PublicPromptProvenance::ReviewFeedback {
                review_run_id: review_run_id.clone(),
                review_round_id: review_round_id.clone(),
                feedback_job_id: feedback_job_id.clone(),
                label: label.clone(),
            }),
            PromptProvenance::Automation { label, .. } => {
                label.as_ref().map(|label| PublicPromptProvenance::System {
                    label: Some(label.clone()),
                })
            }
            PromptProvenance::System { label } => {
                if label.as_deref() == Some("subagent_wake") {
                    return None;
                }
                Some(PublicPromptProvenance::System {
                    label: label.clone(),
                })
            }
        }
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
    context: PromptPrepareContext<'_>,
    blocks: Vec<PromptInputBlock>,
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

    let store = context.store;
    let session_id = context.session_id;
    let workspace_id = context.workspace_id;
    let capabilities = context.capabilities;
    let state = context.attachment_state;
    let plan_resolver = context.plan_resolver;
    let mut stored_blocks = Vec::with_capacity(blocks.len());
    let mut attachments = Vec::new();
    let mut total_attachment_bytes = 0usize;
    let mut attachment_count = 0usize;
    let mut plan_reference_count = 0usize;
    let mut total_plan_reference_bytes = 0usize;
    let mut seen_plan_references = HashSet::new();

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
            PromptInputBlock::PlanReference {
                plan_id,
                snapshot_hash,
            } => {
                if plan_id.trim().is_empty() || snapshot_hash.trim().is_empty() {
                    return Err(PromptValidationError::new(
                        "PROMPT_INVALID_PLAN_REFERENCE",
                        "plan references require planId and snapshotHash",
                    ));
                }
                let key = format!("{plan_id}:{snapshot_hash}");
                if !seen_plan_references.insert(key) {
                    continue;
                }
                let plan = plan_resolver
                    .resolve_plan_reference(&plan_id)
                    .map_err(|error| {
                        PromptValidationError::internal(format!(
                            "failed to load plan reference: {error}"
                        ))
                    })?
                    // Hide cross-workspace attempts behind the same response
                    // as a missing plan so plan ids are not workspace-oracle data.
                    .filter(|plan| plan.workspace_id == workspace_id)
                    .ok_or_else(|| {
                        PromptValidationError::new(
                            "PROMPT_PLAN_NOT_FOUND",
                            "plan reference not found",
                        )
                    })?;
                if plan.snapshot_hash != snapshot_hash {
                    return Err(PromptValidationError::new(
                        "PROMPT_PLAN_SNAPSHOT_MISMATCH",
                        "plan reference snapshot hash does not match",
                    ));
                }
                plan_reference_count = checked_plan_reference_count(plan_reference_count + 1)?;
                total_plan_reference_bytes = checked_plan_reference_total(
                    total_plan_reference_bytes,
                    plan.body_markdown.as_bytes().len(),
                )?;
                stored_blocks.push(StoredPromptBlock::PlanReference {
                    plan_id: plan.id,
                    title: plan.title,
                    body_markdown: plan.body_markdown,
                    snapshot_hash: plan.snapshot_hash,
                    source_session_id: plan.source_session_id,
                    source_turn_id: plan.source_turn_id,
                    source_item_id: plan.source_item_id,
                    source_kind: plan.source_kind,
                    source_tool_call_id: plan.source_tool_call_id,
                    as_resource: capabilities.embedded_context,
                });
            }
        }
    }

    let payload = PromptPayload {
        text_summary: summarize_blocks(&stored_blocks),
        blocks: stored_blocks,
        provenance: None,
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

fn decode_prompt_provenance(value: Option<&str>) -> Option<PromptProvenance> {
    let value = value.map(str::trim).filter(|value| !value.is_empty())?;
    match serde_json::from_str(value) {
        Ok(provenance) => Some(provenance),
        Err(error) => {
            tracing::warn!(error = %error, "invalid pending prompt provenance JSON");
            None
        }
    }
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

fn checked_plan_reference_count(count: usize) -> Result<usize, PromptValidationError> {
    if count > MAX_PLAN_REFERENCES_PER_PROMPT {
        return Err(PromptValidationError::new(
            "PROMPT_TOO_MANY_PLAN_REFERENCES",
            format!(
                "prompt cannot include more than {MAX_PLAN_REFERENCES_PER_PROMPT} plan references"
            ),
        ));
    }
    Ok(count)
}

fn checked_plan_reference_total(
    current: usize,
    next: usize,
) -> Result<usize, PromptValidationError> {
    let total = current.saturating_add(next);
    if total > MAX_TOTAL_PLAN_REFERENCE_BYTES {
        return Err(PromptValidationError::new(
            "PROMPT_PLAN_REFERENCES_TOO_LARGE",
            format!(
                "prompt plan references must total {MAX_TOTAL_PLAN_REFERENCE_BYTES} bytes or less"
            ),
        ));
    }
    Ok(total)
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

fn bounded_preview(text: &str) -> Option<String> {
    let preview = text
        .chars()
        .take(MAX_RESOURCE_PREVIEW_CHARS)
        .collect::<String>();
    (!preview.is_empty()).then_some(preview)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use anyharness_contract::v1::{ProposedPlanDecisionState, ProposedPlanNativeResolutionState};

    use super::*;
    use crate::persistence::Db;
    use crate::sessions::store::SessionStore;

    struct TestPlanResolver {
        plans: HashMap<String, PlanRecord>,
    }

    impl PlanReferenceResolver for TestPlanResolver {
        fn resolve_plan_reference(&self, plan_id: &str) -> anyhow::Result<Option<PlanRecord>> {
            Ok(self.plans.get(plan_id).cloned())
        }
    }

    #[test]
    fn prepares_plan_reference_snapshot() {
        let (store, resolver) = fixture("workspace-1", "# Plan\n\nDo it.");
        let prepared = prepare_prompt(
            context(&store, &resolver, "workspace-1", true),
            vec![PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "hash-1".to_string(),
            }],
        )
        .expect("prepare prompt");

        assert!(prepared.payload.has_content());
        assert_eq!(prepared.payload.text_summary, "[plan: Plan]");
        assert!(matches!(
            prepared.payload.blocks.as_slice(),
            [StoredPromptBlock::PlanReference { plan_id, as_resource: true, .. }]
                if plan_id == "plan-1"
        ));
        assert!(matches!(
            prepared.payload.content_parts().as_slice(),
            [ContentPart::PlanReference { plan_id, snapshot_hash, .. }]
                if plan_id == "plan-1" && snapshot_hash == "hash-1"
        ));
    }

    #[test]
    fn rejects_missing_workspace_or_mismatched_snapshot() {
        let (store, resolver) = fixture("workspace-1", "# Plan\n\nDo it.");
        let missing = prepare_prompt(
            context(&store, &resolver, "workspace-2", false),
            vec![PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "hash-1".to_string(),
            }],
        )
        .expect_err("workspace mismatch should be hidden as not found");
        assert_eq!(missing.code, "PROMPT_PLAN_NOT_FOUND");

        let mismatch = prepare_prompt(
            context(&store, &resolver, "workspace-1", false),
            vec![PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "different".to_string(),
            }],
        )
        .expect_err("snapshot mismatch");
        assert_eq!(mismatch.code, "PROMPT_PLAN_SNAPSHOT_MISMATCH");
    }

    #[test]
    fn dedupes_duplicate_plan_references() {
        let (store, resolver) = fixture("workspace-1", "# Plan\n\nDo it.");
        let prepared = prepare_prompt(
            context(&store, &resolver, "workspace-1", false),
            vec![
                PromptInputBlock::PlanReference {
                    plan_id: "plan-1".to_string(),
                    snapshot_hash: "hash-1".to_string(),
                },
                PromptInputBlock::PlanReference {
                    plan_id: "plan-1".to_string(),
                    snapshot_hash: "hash-1".to_string(),
                },
            ],
        )
        .expect("prepare prompt");

        assert_eq!(prepared.payload.blocks.len(), 1);
    }

    #[test]
    fn enforces_plan_reference_byte_budget() {
        let (store, resolver) = fixture(
            "workspace-1",
            &"x".repeat(MAX_TOTAL_PLAN_REFERENCE_BYTES + 1),
        );
        let error = prepare_prompt(
            context(&store, &resolver, "workspace-1", false),
            vec![PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "hash-1".to_string(),
            }],
        )
        .expect_err("plan reference too large");

        assert_eq!(error.code, "PROMPT_PLAN_REFERENCES_TOO_LARGE");
    }

    #[test]
    fn converts_plan_reference_to_resource_or_text() {
        let (store, resolver) = fixture("workspace-1", "Do it.");
        let resource_payload = prepare_prompt(
            context(&store, &resolver, "workspace-1", true),
            vec![PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "hash-1".to_string(),
            }],
        )
        .expect("prepare resource")
        .payload;
        let resource_blocks = resource_payload
            .to_acp_blocks(&store, "session-1")
            .expect("to acp");
        assert!(matches!(
            resource_blocks.as_slice(),
            [acp::ContentBlock::Resource(_)]
        ));

        let text_payload = prepare_prompt(
            context(&store, &resolver, "workspace-1", false),
            vec![PromptInputBlock::PlanReference {
                plan_id: "plan-1".to_string(),
                snapshot_hash: "hash-1".to_string(),
            }],
        )
        .expect("prepare text")
        .payload;
        let text_blocks = text_payload
            .to_acp_blocks(&store, "session-1")
            .expect("to acp");
        assert!(matches!(
            text_blocks.as_slice(),
            [acp::ContentBlock::Text(_)]
        ));
    }

    #[test]
    fn persisted_prompt_provenance_rejects_invalid_kind_field_combinations() {
        let missing_source = PromptPayload::from_persisted(
            None,
            "hello",
            Some(r#"{"kind":"agent_session","label":"Parent"}"#),
        );
        assert_eq!(missing_source.provenance, None);

        let mixed_fields = PromptPayload::from_persisted(
            None,
            "hello",
            Some(
                r#"{"kind":"agent_session","sourceSessionId":"session-1","automationRunId":"run-1"}"#,
            ),
        );
        assert_eq!(mixed_fields.provenance, None);
    }

    fn context<'a>(
        store: &'a SessionStore,
        resolver: &'a TestPlanResolver,
        workspace_id: &'a str,
        embedded_context: bool,
    ) -> PromptPrepareContext<'a> {
        PromptPrepareContext {
            store,
            session_id: "session-1",
            workspace_id,
            capabilities: PromptCapabilities {
                embedded_context,
                ..PromptCapabilities::default()
            },
            attachment_state: PromptAttachmentState::Pending,
            plan_resolver: resolver,
        }
    }

    fn fixture(workspace_id: &str, body_markdown: &str) -> (SessionStore, TestPlanResolver) {
        let store = SessionStore::new(Db::open_in_memory().expect("in-memory db"));
        let mut plans = HashMap::new();
        plans.insert(
            "plan-1".to_string(),
            PlanRecord {
                id: "plan-1".to_string(),
                workspace_id: workspace_id.to_string(),
                session_id: "session-1".to_string(),
                item_id: "item-1".to_string(),
                title: "Plan".to_string(),
                body_markdown: body_markdown.to_string(),
                snapshot_hash: "hash-1".to_string(),
                decision_state: ProposedPlanDecisionState::Pending,
                native_resolution_state: ProposedPlanNativeResolutionState::None,
                decision_version: 1,
                source_agent_kind: "codex".to_string(),
                source_kind: "codex_turn_plan".to_string(),
                source_session_id: "session-1".to_string(),
                source_turn_id: Some("turn-1".to_string()),
                source_item_id: Some("item-1".to_string()),
                source_tool_call_id: None,
                superseded_by_plan_id: None,
                created_at: "now".to_string(),
                updated_at: "now".to_string(),
            },
        );
        (store, TestPlanResolver { plans })
    }
}
