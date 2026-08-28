use super::product_launch::{ProductMcpLaunchError, ProductMcpLaunchPhase};
use super::summaries::SessionMcpSummaryError;

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

impl WorkspaceMcpAttachmentPhase {
    /// Stable diagnostics token. Queries pin these values, so they may not
    /// drift with the variant names.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Selection => "selection",
            Self::TokenMint => "token_mint",
            Self::SummaryAssembly => "summary_assembly",
            Self::SummaryCleanup => "summary_cleanup",
        }
    }
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

    /// Stable classifier for the redacted `source`. `Debug` drops the source
    /// entirely on purpose, so this is the only channel that lets diagnostics
    /// say what kind of failure happened without emitting its message.
    pub fn source_class(&self) -> &'static str {
        classify_attachment_source(&self.source)
    }
}

fn classify_attachment_source(source: &anyhow::Error) -> &'static str {
    if let Some(error) = source.downcast_ref::<ProductMcpLaunchError>() {
        return match error.phase() {
            ProductMcpLaunchPhase::Selection => "product_selector_failed",
            ProductMcpLaunchPhase::TokenMint => "capability_token_mint_failed",
        };
    }
    if let Some(error) = source.downcast_ref::<SessionMcpSummaryError>() {
        return summary_error_class(error);
    }
    if source.downcast_ref::<rusqlite::Error>().is_some() {
        return "store";
    }
    "internal"
}

/// Stable classifier for binding-summary failures, shared with the assembly
/// site so both records agree on the token.
pub(super) fn summary_error_class(error: &SessionMcpSummaryError) -> &'static str {
    match error {
        SessionMcpSummaryError::Invalid(_) => "binding_summary_invalid",
        SessionMcpSummaryError::Serialize(_) => "binding_summary_serialize_failed",
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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::integrations::mcp::product_server::{
        ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
    };

    static DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
        id: "workspace",
        route_slug: "workspace",
        acp_server_name: "proliferate_workspace",
        server_info_name: "proliferate-workspace",
        display_name: "Workspace",
        description: "Workspace",
        visibility: ProductMcpVisibility::Internal,
        instructions: "Workspace",
        unauthorized_code: "WORKSPACE_MCP_UNAUTHORIZED",
        request_invalid_code: "WORKSPACE_MCP_REQUEST_INVALID",
        prompt_policy: ProductMcpPromptPolicy::System,
    };

    #[test]
    fn phase_tokens_are_stable_snake_case() {
        assert_eq!(WorkspaceMcpAttachmentPhase::Selection.as_str(), "selection");
        assert_eq!(
            WorkspaceMcpAttachmentPhase::TokenMint.as_str(),
            "token_mint"
        );
        assert_eq!(
            WorkspaceMcpAttachmentPhase::SummaryAssembly.as_str(),
            "summary_assembly"
        );
        assert_eq!(
            WorkspaceMcpAttachmentPhase::SummaryCleanup.as_str(),
            "summary_cleanup"
        );
    }

    #[test]
    fn source_class_separates_launch_phases_summaries_and_store_failures() {
        let selection = WorkspaceMcpAttachmentError::from_product_launch(
            ProductMcpLaunchError::selection(DEFINITION.id, anyhow::anyhow!("private detail")),
        );
        assert_eq!(selection.source_class(), "product_selector_failed");

        let token_mint = WorkspaceMcpAttachmentError::from_product_launch(
            ProductMcpLaunchError::token_mint(DEFINITION.id, anyhow::anyhow!("private detail")),
        );
        assert_eq!(token_mint.source_class(), "capability_token_mint_failed");

        let invalid_summary = WorkspaceMcpAttachmentError::summary_assembly(anyhow::Error::new(
            SessionMcpSummaryError::Invalid("private detail".to_string()),
        ));
        assert_eq!(invalid_summary.source_class(), "binding_summary_invalid");

        let serialize_summary = WorkspaceMcpAttachmentError::summary_assembly(anyhow::Error::new(
            SessionMcpSummaryError::Serialize(anyhow::anyhow!("private detail")),
        ));
        assert_eq!(
            serialize_summary.source_class(),
            "binding_summary_serialize_failed"
        );

        let store = WorkspaceMcpAttachmentError::summary_cleanup(anyhow::Error::new(
            rusqlite::Error::QueryReturnedNoRows,
        ));
        assert_eq!(store.source_class(), "store");

        let internal =
            WorkspaceMcpAttachmentError::summary_cleanup(anyhow::anyhow!("private detail"));
        assert_eq!(internal.source_class(), "internal");
    }

    #[test]
    fn source_class_never_leaks_the_source_message() {
        let error = WorkspaceMcpAttachmentError::summary_cleanup(anyhow::anyhow!("private detail"));

        assert!(!error.source_class().contains("private detail"));
        assert!(!format!("{error:?}").contains("private detail"));
        assert!(!error.to_string().contains("private detail"));
    }
}
