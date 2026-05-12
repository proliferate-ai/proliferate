use agent_client_protocol as acp;
use anyharness_contract::v1::{ContentPart, PromptProvenance as PublicPromptProvenance};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};

use crate::domains::plans::document;
use crate::sessions::attachment_storage::PromptAttachmentStorage;
use crate::sessions::service::read_prompt_attachment_content_with_legacy_fallback;
use crate::sessions::store::SessionStore;

use super::blocks::{summarize_blocks, StoredPromptBlock};
use super::error::PromptValidationError;
use super::provenance::{decode_prompt_provenance, PromptProvenance};

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
        attachment_storage: &PromptAttachmentStorage,
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
                    let content = read_prompt_attachment_content_with_legacy_fallback(
                        store,
                        attachment_storage,
                        &attachment,
                    )
                    .map_err(|error| {
                        PromptValidationError::internal(format!(
                            "failed to read image attachment: {error}"
                        ))
                    })?;
                    let image =
                        acp::ImageContent::new(BASE64_STANDARD.encode(content), mime_type.clone())
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
                    let content = read_prompt_attachment_content_with_legacy_fallback(
                        store,
                        attachment_storage,
                        &attachment,
                    )
                    .map_err(|error| {
                        PromptValidationError::internal(format!(
                            "failed to read resource attachment: {error}"
                        ))
                    })?;
                    let text = String::from_utf8(content).map_err(|_| {
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
