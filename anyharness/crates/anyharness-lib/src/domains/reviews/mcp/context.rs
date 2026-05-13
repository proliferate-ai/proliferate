use crate::domains::reviews::runtime::ReviewRuntime;
use crate::integrations::mcp::product_server::{ProductMcpContextError, ProductMcpRequestContext};

#[derive(Debug, Clone, Copy)]
pub enum ReviewMcpRole {
    Parent { can_signal_revision: bool },
    Reviewer,
    None,
}

#[derive(Debug, Clone)]
pub struct ReviewMcpContext {
    pub session_id: String,
    pub role: ReviewMcpRole,
}

pub fn resolve_context(
    runtime: &ReviewRuntime,
    request: &ProductMcpRequestContext,
) -> Result<ReviewMcpContext, ProductMcpContextError> {
    let role = if runtime
        .service()
        .store()
        .find_assignment_for_reviewer_session(&request.session_id)?
        .is_some()
    {
        ReviewMcpRole::Reviewer
    } else {
        let active = runtime
            .service()
            .store()
            .find_active_run_for_parent(&request.session_id)?;
        if let Some(run) = active
            .as_ref()
            .filter(|run| run.workspace_id == request.workspace_id && run.status.is_active())
        {
            ReviewMcpRole::Parent {
                can_signal_revision: runtime.service().run_can_signal_revision_via_mcp(run),
            }
        } else {
            ReviewMcpRole::None
        }
    };

    Ok(ReviewMcpContext {
        session_id: request.session_id.clone(),
        role,
    })
}
