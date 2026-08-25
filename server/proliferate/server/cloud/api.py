from __future__ import annotations

from fastapi import APIRouter

from proliferate.server.agent_auth.api import (
    gateway_account_router as agent_gateway_router,
)
from proliferate.server.agent_auth.api import (
    organization_router as agent_auth_organization_router,
)
from proliferate.server.agent_auth.api import router as agent_auth_router
from proliferate.server.cloud.agent_run_config.api import router as agent_run_config_router
from proliferate.server.cloud.cloud_sandboxes.api import router as cloud_sandboxes_router
from proliferate.server.cloud.harness_launch_options.api import (
    router as harness_launch_options_router,
)
from proliferate.server.cloud.repositories.api import router as repositories_router
from proliferate.server.cloud.secrets.api import router as secrets_router
from proliferate.server.cloud.webhooks.api import router as webhooks_router
from proliferate.server.cloud.workspaces.api import router as workspaces_router
from proliferate.server.cloud.worktree_policy.api import router as worktree_policy_router
from proliferate.server.github.api import (
    organization_router as github_app_organization_router,
)
from proliferate.server.github.api import router as github_app_router
from proliferate.server.github.repos.api import router as repos_router
from proliferate.server.integration_gateway.connections.action_approvals.api import (
    router as integration_action_approvals_router,
)
from proliferate.server.integration_gateway.connections.api import (
    admin_router as integrations_admin_router,
)
from proliferate.server.integration_gateway.connections.api import router as integrations_router
from proliferate.server.integration_gateway.gateway.api import router as integration_gateway_router
from proliferate.server.seam.workers.api import (
    admin_router as runtime_workers_admin_router,
)
from proliferate.server.seam.workers.api import (
    router as runtime_workers_router,
)
from proliferate.server.seam.workers.api import (
    worker_router as runtime_worker_router,
)

# Legacy cloud domains (commands, targets, claims, mobility, live sync,
# runtime config, plugins, skills, slack) are parked: their tables were
# removed in the model cleanup and their routers are intentionally unmounted.

router = APIRouter(prefix="/cloud", tags=["cloud"])
router.include_router(repos_router)
router.include_router(repositories_router)
router.include_router(github_app_router)
router.include_router(github_app_organization_router)
router.include_router(secrets_router)
router.include_router(cloud_sandboxes_router)
router.include_router(workspaces_router)
router.include_router(worktree_policy_router)
router.include_router(agent_auth_router)
router.include_router(agent_auth_organization_router)
router.include_router(agent_gateway_router)
router.include_router(agent_run_config_router)
router.include_router(harness_launch_options_router)
router.include_router(runtime_workers_router)
router.include_router(runtime_worker_router)
router.include_router(runtime_workers_admin_router)
router.include_router(integration_gateway_router)
router.include_router(integration_action_approvals_router)
router.include_router(integrations_router)
router.include_router(integrations_admin_router)
router.include_router(webhooks_router)
