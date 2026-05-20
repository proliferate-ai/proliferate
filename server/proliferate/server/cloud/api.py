from __future__ import annotations

from fastapi import APIRouter

from proliferate.server.cloud.agent_auth.api import router as agent_auth_router
from proliferate.server.cloud.agent_auth.api import worker_router as agent_auth_worker_router
from proliferate.server.cloud.backfill.api import router as backfill_router
from proliferate.server.cloud.capabilities.api import router as capabilities_router
from proliferate.server.cloud.commands.api import router as commands_router
from proliferate.server.cloud.compute.api import router as compute_router
from proliferate.server.cloud.credentials.api import router as credentials_router
from proliferate.server.cloud.events.api import router as events_router
from proliferate.server.cloud.live.api import router as live_router
from proliferate.server.cloud.mcp_catalog.api import router as mcp_catalog_router
from proliferate.server.cloud.mcp_connections.api import router as mcp_connections_router
from proliferate.server.cloud.mcp_oauth.api import router as mcp_oauth_router
from proliferate.server.cloud.mobility.api import router as mobility_router
from proliferate.server.cloud.plugins.api import router as plugins_router
from proliferate.server.cloud.repo_config.api import router as repo_config_router
from proliferate.server.cloud.repos.api import router as repos_router
from proliferate.server.cloud.runtime_config.api import router as runtime_config_router
from proliferate.server.cloud.runtime_config.api import (
    worker_router as runtime_config_worker_router,
)
from proliferate.server.cloud.sandbox_profiles.api import router as sandbox_profiles_router
from proliferate.server.cloud.skills.api import router as skills_router
from proliferate.server.cloud.target_config.api import router as target_config_router
from proliferate.server.cloud.target_config.api import worker_router as target_config_worker_router
from proliferate.server.cloud.target_git_identity.api import (
    worker_router as target_git_identity_worker_router,
)
from proliferate.server.cloud.targets.api import router as targets_router
from proliferate.server.cloud.webhooks.api import router as webhooks_router
from proliferate.server.cloud.worker.api import router as worker_router
from proliferate.server.cloud.workspaces.api import router as workspaces_router
from proliferate.server.cloud.worktree_policy.api import router as worktree_policy_router

router = APIRouter(prefix="/cloud", tags=["cloud"])
router.include_router(repos_router)
router.include_router(repo_config_router)
router.include_router(worktree_policy_router)
router.include_router(capabilities_router)
router.include_router(workspaces_router)
router.include_router(mobility_router)
router.include_router(credentials_router)
router.include_router(sandbox_profiles_router)
router.include_router(agent_auth_router)
router.include_router(mcp_catalog_router)
router.include_router(mcp_connections_router)
router.include_router(mcp_oauth_router)
router.include_router(plugins_router)
router.include_router(skills_router)
router.include_router(webhooks_router)
router.include_router(targets_router)
router.include_router(compute_router)
router.include_router(target_config_router)
router.include_router(commands_router)
router.include_router(events_router)
router.include_router(live_router)
router.include_router(backfill_router)
router.include_router(runtime_config_router)
router.include_router(agent_auth_worker_router)
router.include_router(runtime_config_worker_router)
router.include_router(target_config_worker_router)
router.include_router(target_git_identity_worker_router)
router.include_router(worker_router)
