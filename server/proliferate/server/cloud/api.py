from __future__ import annotations

from fastapi import APIRouter

from proliferate.server.cloud.credentials.api import router as credentials_router
from proliferate.server.cloud.mcp_connections.api import router as mcp_connections_router
from proliferate.server.cloud.mobility.api import router as mobility_router
from proliferate.server.cloud.repo_config.api import router as repo_config_router
from proliferate.server.cloud.repos.api import router as repos_router
from proliferate.server.cloud.webhooks.api import router as webhooks_router
from proliferate.server.cloud.workspaces.api import router as workspaces_router

router = APIRouter(prefix="/cloud", tags=["cloud"])
router.include_router(repos_router)
router.include_router(repo_config_router)
router.include_router(workspaces_router)
router.include_router(mobility_router)
router.include_router(credentials_router)
router.include_router(mcp_connections_router)
router.include_router(webhooks_router)
