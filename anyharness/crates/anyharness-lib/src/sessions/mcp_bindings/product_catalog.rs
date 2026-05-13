use std::sync::Arc;

use crate::domains::cowork::mcp::auth::CoworkMcpAuth;
use crate::domains::reviews::mcp::auth::ReviewMcpAuth;
use crate::sessions::extensions::SessionLaunchExtras;
use crate::sessions::mcp_bindings::injection::{inject_product_mcps, ProductMcpInjectionContext};
use crate::sessions::mcp_bindings::selection::{select_product_mcps, ProductMcpSelectionContext};
use crate::sessions::model::SessionRecord;
use crate::sessions::store::SessionStore;
use crate::sessions::subagents::mcp::auth::SubagentMcpAuth;
use crate::sessions::subagents::service::SubagentService;
use crate::sessions::workspace_naming::mcp::auth::WorkspaceNamingMcpAuth;
use crate::workspaces::model::WorkspaceRecord;

#[derive(Clone)]
pub struct ProductMcpLaunchCatalog {
    inner: Option<Arc<ProductMcpLaunchCatalogInner>>,
}

struct ProductMcpLaunchCatalogInner {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    review_auth: Arc<ReviewMcpAuth>,
    subagent_auth: Arc<SubagentMcpAuth>,
    workspace_naming_auth: Arc<WorkspaceNamingMcpAuth>,
    cowork_auth: Arc<CoworkMcpAuth>,
    subagent_service: Arc<SubagentService>,
    session_store: SessionStore,
}

impl ProductMcpLaunchCatalog {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        review_auth: Arc<ReviewMcpAuth>,
        subagent_auth: Arc<SubagentMcpAuth>,
        workspace_naming_auth: Arc<WorkspaceNamingMcpAuth>,
        cowork_auth: Arc<CoworkMcpAuth>,
        subagent_service: Arc<SubagentService>,
        session_store: SessionStore,
    ) -> Self {
        Self {
            inner: Some(Arc::new(ProductMcpLaunchCatalogInner {
                runtime_base_url,
                runtime_bearer_token,
                review_auth,
                subagent_auth,
                workspace_naming_auth,
                cowork_auth,
                subagent_service,
                session_store,
            })),
        }
    }

    pub fn disabled() -> Self {
        Self { inner: None }
    }

    pub fn resolve_launch_extras(
        &self,
        workspace: &WorkspaceRecord,
        session: &SessionRecord,
    ) -> anyhow::Result<SessionLaunchExtras> {
        let Some(inner) = self.inner.as_ref() else {
            return Ok(SessionLaunchExtras::default());
        };
        let selected = select_product_mcps(ProductMcpSelectionContext {
            workspace,
            session,
            subagent_service: &inner.subagent_service,
            session_store: &inner.session_store,
        })?;
        inject_product_mcps(
            &selected,
            ProductMcpInjectionContext {
                runtime_base_url: &inner.runtime_base_url,
                runtime_bearer_token: inner.runtime_bearer_token.as_deref(),
                review_auth: &inner.review_auth,
                subagent_auth: &inner.subagent_auth,
                workspace_naming_auth: &inner.workspace_naming_auth,
                cowork_auth: &inner.cowork_auth,
                workspace,
                session,
            },
        )
    }
}
