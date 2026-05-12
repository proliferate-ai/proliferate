use anyharness_contract::v1::PromptCapabilities;

use crate::domains::plans::model::PlanRecord;
use crate::sessions::attachment_storage::PromptAttachmentStorage;
use crate::sessions::model::PromptAttachmentState;
use crate::sessions::store::SessionStore;

mod attachments;
mod blocks;
mod capabilities;
mod error;
mod payload;
mod prepare;
mod provenance;

#[cfg(test)]
mod tests;

pub use attachments::{PreparedPrompt, PreparedPromptAttachment};
pub use blocks::StoredPromptBlock;
pub use capabilities::{capabilities_from_acp, capabilities_from_live_config};
pub use error::PromptValidationError;
pub use payload::PromptPayload;
pub use prepare::prepare_prompt;
pub(crate) use provenance::PromptProvenance;

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
    pub attachment_storage: &'a PromptAttachmentStorage,
    pub session_id: &'a str,
    pub workspace_id: &'a str,
    pub capabilities: PromptCapabilities,
    pub attachment_state: PromptAttachmentState,
    pub plan_resolver: &'a dyn PlanReferenceResolver,
}
