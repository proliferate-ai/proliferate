use agent_client_protocol as acp;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};

use super::{PromptPayload, PromptValidationError, StoredPromptBlock};
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::plan_references::render_plan_reference_markdown;
use crate::domains::sessions::service::attachments::read_prompt_attachment_content_with_legacy_fallback;
use crate::domains::sessions::store::SessionStore;

impl PromptPayload {
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
                    let markdown = render_plan_reference_markdown(title, body_markdown);
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
