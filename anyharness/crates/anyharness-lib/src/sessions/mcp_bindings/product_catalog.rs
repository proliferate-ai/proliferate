use std::sync::Arc;

use crate::sessions::extensions::SessionLaunchExtras;
use crate::sessions::mcp_bindings::injection::{inject_product_mcps, ProductMcpInjectionContext};
use crate::sessions::mcp_bindings::product_launch::ProductMcpLaunchRegistration;
use crate::sessions::mcp_bindings::selection::select_product_mcps;
use crate::sessions::model::SessionRecord;
use crate::workspaces::model::WorkspaceRecord;

#[derive(Clone)]
pub struct ProductMcpLaunchCatalog {
    inner: Option<Arc<ProductMcpLaunchCatalogInner>>,
}

struct ProductMcpLaunchCatalogInner {
    runtime_base_url: String,
    runtime_bearer_token: Option<String>,
    registrations: Vec<ProductMcpLaunchRegistration>,
}

impl ProductMcpLaunchCatalog {
    pub fn new(
        runtime_base_url: String,
        runtime_bearer_token: Option<String>,
        registrations: Vec<ProductMcpLaunchRegistration>,
    ) -> Self {
        Self {
            inner: Some(Arc::new(ProductMcpLaunchCatalogInner {
                runtime_base_url,
                runtime_bearer_token,
                registrations,
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
        let selected = select_product_mcps(workspace, session, &inner.registrations)?;
        inject_product_mcps(
            &selected,
            ProductMcpInjectionContext {
                runtime_base_url: &inner.runtime_base_url,
                runtime_bearer_token: inner.runtime_bearer_token.as_deref(),
                workspace,
                session,
            },
        )
    }
}
