use super::product_launch::{ProductMcpLaunchError, ProductMcpLaunchPhase};

pub const WORKSPACE_MCP_ATTACHMENT_CODE: &str = "WORKSPACE_MCP_ATTACHMENT_FAILED";
pub const WORKSPACE_MCP_ATTACHMENT_DETAIL: &str =
    "Workspace MCP could not be attached to the session.";

pub(crate) fn is_retired_subagents_mcp_binding_summary_id(id: &str) -> bool {
    id == "subagents" || id == "internal:subagents"
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceMcpAttachmentPhase {
    Selection,
    TokenMint,
    SummaryAssembly,
    SummaryCleanup,
}

pub struct WorkspaceMcpAttachmentError {
    phase: WorkspaceMcpAttachmentPhase,
    source: anyhow::Error,
}

impl WorkspaceMcpAttachmentError {
    pub(super) fn from_product_launch(error: ProductMcpLaunchError) -> Self {
        let phase = match error.phase() {
            ProductMcpLaunchPhase::Selection => WorkspaceMcpAttachmentPhase::Selection,
            ProductMcpLaunchPhase::TokenMint => WorkspaceMcpAttachmentPhase::TokenMint,
        };
        Self {
            phase,
            source: anyhow::Error::new(error),
        }
    }

    pub(super) fn summary_assembly(source: anyhow::Error) -> Self {
        Self {
            phase: WorkspaceMcpAttachmentPhase::SummaryAssembly,
            source,
        }
    }

    pub(crate) fn summary_cleanup(source: anyhow::Error) -> Self {
        Self {
            phase: WorkspaceMcpAttachmentPhase::SummaryCleanup,
            source,
        }
    }

    pub fn phase(&self) -> WorkspaceMcpAttachmentPhase {
        self.phase
    }
}

impl std::fmt::Debug for WorkspaceMcpAttachmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkspaceMcpAttachmentError")
            .field("phase", &self.phase)
            .finish_non_exhaustive()
    }
}

impl std::fmt::Display for WorkspaceMcpAttachmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Workspace MCP attachment failed during {:?}", self.phase)
    }
}

impl std::error::Error for WorkspaceMcpAttachmentError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.source.as_ref())
    }
}
