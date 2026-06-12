//! Pure rendering of a stored prompt payload into ACP content blocks.
//!
//! No IO: attachment bytes arrive pre-loaded in [`ResolvedParts`] (see
//! `load_prompt_attachments`), plan references render from their frozen
//! `body_markdown` snapshot, and the codex first-prompt append arrives as an
//! already-decided string in [`TurnPromptExtras`]. Base64 encoding and UTF-8
//! validation are pure compute and belong here.

use agent_client_protocol as acp;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};

use super::{PromptPayload, PromptValidationError, ResolvedParts, StoredPromptBlock};
use crate::domains::sessions::plan_references::render_plan_reference_markdown;

/// Render failures speak the same code/detail vocabulary as prompt
/// validation; the split must not change error semantics.
pub type RenderError = PromptValidationError;

/// Per-turn additions the actor decided before rendering.
#[derive(Debug, Clone, Default)]
pub struct TurnPromptExtras {
    /// When set, prepended as a hidden system-instruction text block (the
    /// codex first-prompt append). The has-turn-started gating is the
    /// caller's decision; render folds the result in verbatim.
    pub first_prompt_system_prompt_append: Option<String>,
}

pub fn render(
    payload: &PromptPayload,
    parts: &ResolvedParts,
    extras: &TurnPromptExtras,
) -> Result<Vec<acp::schema::ContentBlock>, RenderError> {
    let mut blocks = Vec::with_capacity(payload.blocks.len());
    for block in &payload.blocks {
        match block {
            StoredPromptBlock::Text { text } => {
                blocks.push(acp::schema::ContentBlock::Text(acp::schema::TextContent::new(
                    text.clone(),
                )));
            }
            StoredPromptBlock::Image {
                attachment_id,
                mime_type,
                uri,
                ..
            } => {
                let attachment = parts.attachments.get(attachment_id).ok_or_else(|| {
                    RenderError::new("PROMPT_ATTACHMENT_NOT_FOUND", "image attachment not found")
                })?;
                let image = acp::schema::ImageContent::new(
                    BASE64_STANDARD.encode(&attachment.bytes),
                    mime_type.clone(),
                )
                .uri(uri.clone());
                blocks.push(acp::schema::ContentBlock::Image(image));
            }
            StoredPromptBlock::Resource {
                attachment_id: Some(attachment_id),
                uri,
                mime_type,
                ..
            } => {
                let attachment = parts.attachments.get(attachment_id).ok_or_else(|| {
                    RenderError::new(
                        "PROMPT_ATTACHMENT_NOT_FOUND",
                        "resource attachment not found",
                    )
                })?;
                let text = String::from_utf8(attachment.bytes.clone()).map_err(|_| {
                    RenderError::new(
                        "PROMPT_UNSUPPORTED_BINARY_RESOURCE",
                        "embedded resources must be UTF-8 text",
                    )
                })?;
                let resource = acp::schema::TextResourceContents::new(text, uri.clone())
                    .mime_type(mime_type.clone());
                blocks.push(acp::schema::ContentBlock::Resource(
                    acp::schema::EmbeddedResource::new(
                        acp::schema::EmbeddedResourceResource::TextResourceContents(resource),
                    ),
                ));
            }
            StoredPromptBlock::Resource {
                attachment_id: None,
                ..
            } => {
                return Err(RenderError::new(
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
                let link = acp::schema::ResourceLink::new(name.clone(), uri.clone())
                    .mime_type(mime_type.clone())
                    .title(title.clone())
                    .description(description.clone())
                    .size(size);
                blocks.push(acp::schema::ContentBlock::ResourceLink(link));
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
                    let resource = acp::schema::TextResourceContents::new(markdown, uri)
                        .mime_type(Some("text/markdown".to_string()));
                    blocks.push(acp::schema::ContentBlock::Resource(
                        acp::schema::EmbeddedResource::new(
                            acp::schema::EmbeddedResourceResource::TextResourceContents(resource),
                        ),
                    ));
                } else {
                    blocks.push(acp::schema::ContentBlock::Text(acp::schema::TextContent::new(
                        markdown,
                    )));
                }
            }
        }
    }
    if let Some(append) = &extras.first_prompt_system_prompt_append {
        blocks.insert(
            0,
            acp::schema::ContentBlock::Text(acp::schema::TextContent::new(format!(
                "System instruction from AnyHarness, not user content:\n{append}"
            ))),
        );
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::prompt::{ResolvedAttachment, ResolvedAttachmentKind};

    fn payload(blocks: Vec<StoredPromptBlock>) -> PromptPayload {
        PromptPayload {
            blocks,
            text_summary: String::new(),
            provenance: None,
        }
    }

    fn parts(attachments: Vec<ResolvedAttachment>) -> ResolvedParts {
        ResolvedParts {
            attachments: attachments
                .into_iter()
                .map(|attachment| (attachment.attachment_id.clone(), attachment))
                .collect(),
        }
    }

    fn image_block(attachment_id: &str) -> StoredPromptBlock {
        StoredPromptBlock::Image {
            attachment_id: attachment_id.to_string(),
            mime_type: "image/png".to_string(),
            name: None,
            uri: Some("file:///shot.png".to_string()),
            size: 3,
            source: None,
        }
    }

    fn resource_block(attachment_id: &str) -> StoredPromptBlock {
        StoredPromptBlock::Resource {
            attachment_id: Some(attachment_id.to_string()),
            uri: "file:///notes.md".to_string(),
            name: None,
            mime_type: Some("text/markdown".to_string()),
            size: 5,
            preview: None,
            source: None,
        }
    }

    fn attachment(id: &str, kind: ResolvedAttachmentKind, bytes: &[u8]) -> ResolvedAttachment {
        ResolvedAttachment {
            attachment_id: id.to_string(),
            kind,
            mime_type: None,
            uri: None,
            bytes: bytes.to_vec(),
        }
    }

    #[test]
    fn renders_text_blocks_verbatim() {
        let blocks = render(
            &payload(vec![StoredPromptBlock::Text {
                text: "hello".to_string(),
            }]),
            &ResolvedParts::default(),
            &TurnPromptExtras::default(),
        )
        .expect("render");

        let [acp::schema::ContentBlock::Text(text)] = blocks.as_slice() else {
            panic!("expected one text block");
        };
        assert_eq!(text.text, "hello");
    }

    #[test]
    fn renders_image_blocks_as_base64_with_block_metadata() {
        let blocks = render(
            &payload(vec![image_block("att-1")]),
            &parts(vec![attachment(
                "att-1",
                ResolvedAttachmentKind::Image,
                b"png",
            )]),
            &TurnPromptExtras::default(),
        )
        .expect("render");

        let [acp::schema::ContentBlock::Image(image)] = blocks.as_slice() else {
            panic!("expected one image block");
        };
        assert_eq!(image.data, BASE64_STANDARD.encode(b"png"));
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(image.uri.as_deref(), Some("file:///shot.png"));
    }

    #[test]
    fn renders_text_resources_as_embedded_resources() {
        let blocks = render(
            &payload(vec![resource_block("att-1")]),
            &parts(vec![attachment(
                "att-1",
                ResolvedAttachmentKind::TextResource,
                b"notes",
            )]),
            &TurnPromptExtras::default(),
        )
        .expect("render");

        let [acp::schema::ContentBlock::Resource(resource)] = blocks.as_slice() else {
            panic!("expected one resource block");
        };
        let acp::schema::EmbeddedResourceResource::TextResourceContents(contents) =
            &resource.resource
        else {
            panic!("expected text resource contents");
        };
        assert_eq!(contents.text, "notes");
        assert_eq!(contents.uri, "file:///notes.md");
        assert_eq!(contents.mime_type.as_deref(), Some("text/markdown"));
    }

    #[test]
    fn rejects_binary_text_resources() {
        let error = render(
            &payload(vec![resource_block("att-1")]),
            &parts(vec![attachment(
                "att-1",
                ResolvedAttachmentKind::TextResource,
                &[0xff, 0xfe],
            )]),
            &TurnPromptExtras::default(),
        )
        .expect_err("binary resource");
        assert_eq!(error.code, "PROMPT_UNSUPPORTED_BINARY_RESOURCE");
    }

    fn plan_block(as_resource: bool) -> StoredPromptBlock {
        StoredPromptBlock::PlanReference {
            plan_id: "plan-1".to_string(),
            title: "Plan".to_string(),
            body_markdown: "Do it.".to_string(),
            snapshot_hash: "hash-1".to_string(),
            source_session_id: "session-1".to_string(),
            source_turn_id: None,
            source_item_id: None,
            source_kind: "codex_turn_plan".to_string(),
            source_tool_call_id: None,
            as_resource,
        }
    }

    #[test]
    fn renders_plan_references_as_resource_or_text() {
        let blocks = render(
            &payload(vec![plan_block(true)]),
            &ResolvedParts::default(),
            &TurnPromptExtras::default(),
        )
        .expect("render");
        let [acp::schema::ContentBlock::Resource(resource)] = blocks.as_slice() else {
            panic!("expected one resource block");
        };
        let acp::schema::EmbeddedResourceResource::TextResourceContents(contents) =
            &resource.resource
        else {
            panic!("expected text resource contents");
        };
        assert_eq!(contents.uri, "plan://plan-1?snapshot=hash-1");
        assert_eq!(contents.text, "# Plan\n\nDo it.\n");
        assert_eq!(contents.mime_type.as_deref(), Some("text/markdown"));

        let blocks = render(
            &payload(vec![plan_block(false)]),
            &ResolvedParts::default(),
            &TurnPromptExtras::default(),
        )
        .expect("render");
        let [acp::schema::ContentBlock::Text(text)] = blocks.as_slice() else {
            panic!("expected one text block");
        };
        assert_eq!(text.text, "# Plan\n\nDo it.\n");
    }

    #[test]
    fn prepends_first_prompt_append_as_hidden_instruction_block() {
        let blocks = render(
            &payload(vec![StoredPromptBlock::Text {
                text: "Build a product".to_string(),
            }]),
            &ResolvedParts::default(),
            &TurnPromptExtras {
                first_prompt_system_prompt_append: Some("Name the workspace first.".to_string()),
            },
        )
        .expect("render");

        assert_eq!(blocks.len(), 2);
        let acp::schema::ContentBlock::Text(first) = &blocks[0] else {
            panic!("first block should be text");
        };
        assert!(first.text.contains("System instruction from AnyHarness"));
        assert!(first.text.contains("Name the workspace first."));
        let acp::schema::ContentBlock::Text(second) = &blocks[1] else {
            panic!("second block should be text");
        };
        assert_eq!(second.text, "Build a product");
    }

    #[test]
    fn errors_when_referenced_attachment_was_not_loaded() {
        let image = render(
            &payload(vec![image_block("missing")]),
            &ResolvedParts::default(),
            &TurnPromptExtras::default(),
        )
        .expect_err("missing image attachment");
        assert_eq!(image.code, "PROMPT_ATTACHMENT_NOT_FOUND");
        assert_eq!(image.detail, "image attachment not found");

        let resource = render(
            &payload(vec![resource_block("missing")]),
            &ResolvedParts::default(),
            &TurnPromptExtras::default(),
        )
        .expect_err("missing resource attachment");
        assert_eq!(resource.code, "PROMPT_ATTACHMENT_NOT_FOUND");
        assert_eq!(resource.detail, "resource attachment not found");

        let unresolved = render(
            &payload(vec![StoredPromptBlock::Resource {
                attachment_id: None,
                uri: "file:///notes.md".to_string(),
                name: None,
                mime_type: None,
                size: 0,
                preview: None,
                source: None,
            }]),
            &ResolvedParts::default(),
            &TurnPromptExtras::default(),
        )
        .expect_err("resource without attachment id");
        assert_eq!(unresolved.code, "PROMPT_ATTACHMENT_NOT_FOUND");
    }
}
