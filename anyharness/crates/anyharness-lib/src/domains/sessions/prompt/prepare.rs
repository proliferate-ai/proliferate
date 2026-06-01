use std::collections::HashSet;

use anyharness_contract::v1::{
    PromptAttachmentSource as ContractPromptAttachmentSource, PromptInputBlock,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use sha2::{Digest, Sha256};

use super::{
    summarize_blocks, PreparedPrompt, PreparedPromptAttachment, PromptPrepareContext,
    PromptValidationError, StoredPromptBlock, MAX_ATTACHMENTS_PER_PROMPT, MAX_IMAGE_BYTES,
    MAX_PLAN_REFERENCES_PER_PROMPT, MAX_PROMPT_BLOCKS, MAX_RESOURCE_PREVIEW_CHARS,
    MAX_TEXT_RESOURCE_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, MAX_TOTAL_PLAN_REFERENCE_BYTES,
};
use crate::domains::sessions::attachment_storage::PromptAttachmentStorage;
use crate::domains::sessions::model::{
    PromptAttachmentKind, PromptAttachmentRecord, PromptAttachmentSource, PromptAttachmentState,
};
use crate::domains::sessions::store::SessionStore;

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
    let attachment_storage = context.attachment_storage;
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
                source,
            } => {
                let source = prompt_attachment_source(source);
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
                            attachment_storage,
                            session_id,
                            attachment_id.clone(),
                            state,
                            PromptAttachmentKind::Image,
                            source,
                            Some(mime_type.clone()),
                            name.clone(),
                            uri.clone(),
                            bytes,
                        ));
                        stored_blocks.push(StoredPromptBlock::Image {
                            uri: Some(managed_attachment_uri(session_id, &attachment_id)),
                            attachment_id,
                            mime_type,
                            name,
                            size,
                            source: Some(source.into_contract()),
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
                        let byte_len = attachment.size_bytes.max(0) as usize;
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
                            uri: Some(managed_attachment_uri(session_id, &attachment_id)),
                            attachment_id,
                            mime_type,
                            name,
                            size: byte_len as u64,
                            source: Some(attachment.source.into_contract()),
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
                source,
            } => {
                let source = prompt_attachment_source(source);
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
                            attachment_storage,
                            session_id,
                            attachment_id.clone(),
                            state,
                            PromptAttachmentKind::TextResource,
                            source,
                            mime_type.clone(),
                            name.clone(),
                            Some(uri.clone()),
                            bytes,
                        ));
                        stored_blocks.push(StoredPromptBlock::Resource {
                            uri: managed_attachment_uri(session_id, &attachment_id),
                            attachment_id: Some(attachment_id),
                            name,
                            mime_type,
                            size,
                            preview,
                            source: Some(source.into_contract()),
                        });
                    }
                    (None, Some(attachment_id)) => {
                        let attachment = validate_referenced_attachment(
                            store,
                            session_id,
                            &attachment_id,
                            PromptAttachmentKind::TextResource,
                        )?;
                        let byte_len = attachment.size_bytes.max(0) as usize;
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
                            uri: managed_attachment_uri(session_id, &attachment_id),
                            attachment_id: Some(attachment_id),
                            name,
                            mime_type: mime_type.or_else(|| attachment.mime_type.clone()),
                            size: declared_size.unwrap_or(byte_len as u64),
                            preview: None,
                            source: Some(attachment.source.into_contract()),
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

    let payload = super::PromptPayload {
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

fn prompt_attachment_source(
    source: Option<ContractPromptAttachmentSource>,
) -> PromptAttachmentSource {
    match source {
        Some(ContractPromptAttachmentSource::Paste) => PromptAttachmentSource::Paste,
        _ => PromptAttachmentSource::Upload,
    }
}

fn managed_attachment_uri(session_id: &str, attachment_id: &str) -> String {
    format!("anyharness-attachment://sessions/{session_id}/attachments/{attachment_id}")
}

impl PromptAttachmentSource {
    fn into_contract(self) -> ContractPromptAttachmentSource {
        match self {
            PromptAttachmentSource::Upload => ContractPromptAttachmentSource::Upload,
            PromptAttachmentSource::Paste => ContractPromptAttachmentSource::Paste,
        }
    }
}

fn bounded_preview(text: &str) -> Option<String> {
    let preview = text
        .chars()
        .take(MAX_RESOURCE_PREVIEW_CHARS)
        .collect::<String>();
    (!preview.is_empty()).then_some(preview)
}
