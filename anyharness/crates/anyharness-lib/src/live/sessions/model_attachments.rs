//! Prompt-attachment loading and hygiene as the actor's turn machinery needs
//! it. Split out of `model.rs` (see `guides/domains.md` on module growth): a
//! separate concern (prompt-attachment loading IO) with a small blast radius.

use crate::domains::sessions::model::{PromptAttachmentRecord, PromptAttachmentState};
use crate::domains::sessions::prompt::{PromptPayload, PromptValidationError, ResolvedParts};

/// Prompt-attachment loading and hygiene as the actor's turn machinery needs
/// it. `load` is the IO half of the prompt pipeline; the pure render half is
/// `domains::sessions::prompt::render::render`, which the actor calls itself.
pub trait AttachmentSource: Send + Sync {
    /// Load every attachment the payload references: store rows plus stored
    /// bytes (including the legacy-content fallback). No ACP shapes here —
    /// rendering them is pure and stays out of the capability.
    fn load(
        &self,
        session_id: &str,
        payload: &PromptPayload,
    ) -> Result<ResolvedParts, PromptValidationError>;
    fn mark_prompt_attachments_state(
        &self,
        session_id: &str,
        attachment_ids: &[String],
        state: PromptAttachmentState,
    ) -> anyhow::Result<()>;
    fn find_prompt_attachment(
        &self,
        session_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Option<PromptAttachmentRecord>>;
    fn delete_prompt_attachments(
        &self,
        session_id: &str,
        attachment_ids: &[&str],
    ) -> anyhow::Result<()>;
    /// Delete the stored attachment file for a (pending) record.
    fn delete_record(&self, record: &PromptAttachmentRecord) -> anyhow::Result<()>;
}
