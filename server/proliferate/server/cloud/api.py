from __future__ import annotations

from fastapi import APIRouter

# AGENT AUTH PARKED: retarget away from sandbox_profile/cloud_targets before remounting.
# from proliferate.server.cloud.agent_auth.api import router as agent_auth_router
# from proliferate.server.cloud.agent_auth.api import worker_router as agent_auth_worker_router
from proliferate.server.cloud.agent_run_config.api import router as agent_run_config_router
# BACKFILL PARKED: old cloud-sync tables were removed in the model cleanup.
# from proliferate.server.cloud.backfill.api import router as backfill_router
from proliferate.server.cloud.capabilities.api import router as capabilities_router
# CLAIMS PARKED: old workspace exposure tables were removed in the model cleanup.
# from proliferate.server.cloud.claims.api import router as claims_router
# COMMANDS PARKED: old cloud-command tables were removed in the model cleanup.
# from proliferate.server.cloud.commands.api import router as commands_router
# TARGETS PARKED: old target/profile tables were removed in the model cleanup.
# from proliferate.server.cloud.compute.api import router as compute_router
# EVENTS PARKED: old cloud event sync tables were removed in the model cleanup.
# from proliferate.server.cloud.events.api import router as events_router
from proliferate.server.cloud.github_app.api import router as github_app_router
from proliferate.server.cloud.integration_policy.api import router as integration_policy_router
# LIVE TARGETS PARKED: old target sync tables were removed in the model cleanup.
# from proliferate.server.cloud.live.api import router as live_router
from proliferate.server.cloud.cloud_sandboxes.api import router as cloud_sandboxes_router
from proliferate.server.cloud.mcp_catalog.api import router as mcp_catalog_router
# MCP CONNECTIONS PARKED: retarget away from sandbox profiles before remounting.
# from proliferate.server.cloud.mcp_connections.api import router as mcp_connections_router
# MCP OAUTH PARKED: retarget away from sandbox profiles before remounting.
# from proliferate.server.cloud.mcp_oauth.api import router as mcp_oauth_router
# MOBILITY PARKED: old exposure/handoff tables were removed in the model cleanup.
# from proliferate.server.cloud.mobility.api import router as mobility_router
# PLUGINS PARKED: retarget away from sandbox profiles before remounting.
# from proliferate.server.cloud.plugins.api import router as plugins_router
# REPO CONFIG PARKED: replaced by repo environment routes.
# from proliferate.server.cloud.repo_config.api import router as repo_config_router
from proliferate.server.cloud.repositories.api import router as repositories_router
from proliferate.server.cloud.repos.api import router as repos_router
# TARGETS PARKED: old runtime-config/profile routes depend on deleted target tables.
# from proliferate.server.cloud.runtime_config.api import router as runtime_config_router
# from proliferate.server.cloud.runtime_config.api import (
#     worker_router as runtime_config_worker_router,
# )
# from proliferate.server.cloud.sandbox_profiles.api import router as sandbox_profiles_router
# SECRETS PARKED: retarget workspace secrets from legacy cloud repo config in PR #2.
# from proliferate.server.cloud.secrets.api import router as secrets_router
# SKILLS PARKED: retarget away from sandbox profiles before remounting.
# from proliferate.server.cloud.skills.api import router as skills_router
# TARGETS PARKED.
# from proliferate.server.cloud.target_config.api import router as target_config_router
# from proliferate.server.cloud.target_config.api import worker_router as target_config_worker_router
# from proliferate.server.cloud.target_git_identity.api import (
#     worker_router as target_git_identity_worker_router,
# )
# from proliferate.server.cloud.targets.api import router as targets_router
# WEBHOOKS PARKED: E2B webhook handling must be retargeted to CloudSandbox.
# from proliferate.server.cloud.webhooks.api import router as webhooks_router
# WORKER PARKED: old worker target routes depend on deleted target tables.
# from proliferate.server.cloud.worker.api import router as worker_router
# WORKSPACES PARKED: new workspace/resume flow lands in a later PR.
# from proliferate.server.cloud.workspaces.api import router as workspaces_router
from proliferate.server.cloud.worktree_policy.api import router as worktree_policy_router

# SLACK BOT PARKED: preserve the Slack API module, but do not mount its routes.
# from proliferate.server.cloud.slack.api import router as slack_router

router = APIRouter(prefix="/cloud", tags=["cloud"])
router.include_router(repos_router)
router.include_router(repositories_router)
# REPO CONFIG PARKED: /v1/cloud/repos/*/config is intentionally disabled.
# router.include_router(repo_config_router)
router.include_router(github_app_router)
# SECRETS PARKED: /v1/cloud/secrets/* is intentionally disabled.
# router.include_router(secrets_router)
router.include_router(cloud_sandboxes_router)
# WORKSPACES PARKED: /v1/cloud/workspaces/* is intentionally disabled.
# router.include_router(workspaces_router)
router.include_router(worktree_policy_router)
router.include_router(capabilities_router)
# CLAIMS PARKED: /v1/cloud/claims/* is intentionally disabled.
# router.include_router(claims_router)
# MOBILITY PARKED: /v1/cloud/mobility/* is intentionally disabled.
# router.include_router(mobility_router)
# TARGETS PARKED: /v1/cloud/sandbox-profiles/* is intentionally disabled.
# router.include_router(sandbox_profiles_router)
# AGENT AUTH PARKED: /v1/cloud/agent-auth/* is intentionally disabled.
# router.include_router(agent_auth_router)
router.include_router(agent_run_config_router)
router.include_router(integration_policy_router)
router.include_router(mcp_catalog_router)
# MCP CONNECTIONS PARKED: /v1/cloud/mcp-connections/* is intentionally disabled.
# router.include_router(mcp_connections_router)
# MCP OAUTH PARKED: /v1/cloud/mcp-oauth/* is intentionally disabled.
# router.include_router(mcp_oauth_router)
# PLUGINS PARKED: /v1/cloud/plugins/* is intentionally disabled.
# router.include_router(plugins_router)
# SKILLS PARKED: /v1/cloud/skills/* is intentionally disabled.
# router.include_router(skills_router)
# SLACK BOT PARKED: /v1/cloud/slack/* is intentionally disabled and returns 404.
# router.include_router(slack_router)
# WEBHOOKS PARKED: /v1/cloud/webhooks/* is intentionally disabled.
# router.include_router(webhooks_router)
# TARGETS PARKED: /v1/cloud/targets and compute routes are intentionally disabled.
# router.include_router(targets_router)
# router.include_router(compute_router)
# router.include_router(target_config_router)
# COMMANDS PARKED: /v1/cloud/commands/* is intentionally disabled.
# router.include_router(commands_router)
# EVENTS PARKED: /v1/cloud/events/* is intentionally disabled.
# router.include_router(events_router)
# LIVE TARGETS PARKED: /v1/cloud/live/* is intentionally disabled.
# router.include_router(live_router)
# BACKFILL PARKED: /v1/cloud/backfill/* is intentionally disabled.
# router.include_router(backfill_router)
# TARGETS PARKED: /v1/cloud/runtime-config/* is intentionally disabled.
# router.include_router(runtime_config_router)
# AGENT AUTH PARKED: worker agent-auth routes are intentionally disabled.
# router.include_router(agent_auth_worker_router)
# TARGETS PARKED: worker target routes are intentionally disabled.
# router.include_router(runtime_config_worker_router)
# router.include_router(target_config_worker_router)
# router.include_router(target_git_identity_worker_router)
# router.include_router(worker_router)
