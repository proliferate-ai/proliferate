"""Fixture data for faux cloud-visible workspace seeding."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import quote

SEED_TEMPLATE_VERSION = "dev-faux-ui-v1"
SEED_NAMESPACE = uuid.UUID("1387081f-19ad-4551-927b-c637e9f856d8")
DEFAULT_PROFILE = "shared"
DEFAULT_DB_USER = "proliferate"
DEFAULT_DB_PASSWORD = "localdev"
DEFAULT_DB_HOST = "[::1]"
DEFAULT_DB_PORT = 5432
PROFILE_NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")

TargetKey = Literal[
    "personal_cloud",
    "shared_cloud",
    "local_desktop",
    "ssh_popos",
    "self_hosted",
]
OwnerScope = Literal["personal", "organization"]


@dataclass(frozen=True)
class TargetFixture:
    key: TargetKey
    display_name: str
    kind: str
    owner_scope: OwnerScope
    workspace_root: str | None


@dataclass(frozen=True)
class WorkspaceFixture:
    slug: str
    display_name: str
    git_branch: str
    target_key: TargetKey
    owner_scope: OwnerScope
    origin: str
    origin_context: dict[str, str]
    visibility: str
    workspace_status: str
    session_status: str
    session_title: str
    minutes_ago: int
    source_agent_kind: str
    prompt: str
    response: str
    git_owner: str = "proliferate-ai"
    git_repo_name: str = "proliferate"
    git_base_branch: str = "main"
    exposure_projected: bool = True
    claim_source_kind: str | None = None
    last_error: str | None = None


TARGET_FIXTURES: tuple[TargetFixture, ...] = (
    TargetFixture(
        key="personal_cloud",
        display_name="Faux personal cloud",
        kind="managed_cloud",
        owner_scope="personal",
        workspace_root=None,
    ),
    TargetFixture(
        key="shared_cloud",
        display_name="Faux shared cloud",
        kind="managed_cloud",
        owner_scope="organization",
        workspace_root=None,
    ),
    TargetFixture(
        key="local_desktop",
        display_name="Faux local desktop",
        kind="desktop_dispatch",
        owner_scope="personal",
        workspace_root="~/Proliferate/workspaces",
    ),
    TargetFixture(
        key="ssh_popos",
        display_name="Faux SSH target",
        kind="ssh",
        owner_scope="personal",
        workspace_root="/home/pablo/proliferate-workspaces",
    ),
    TargetFixture(
        key="self_hosted",
        display_name="Faux self-hosted cloud",
        kind="self_hosted_cloud",
        owner_scope="organization",
        workspace_root="/srv/proliferate/workspaces",
    ),
)


WORKSPACE_FIXTURES: tuple[WorkspaceFixture, ...] = (
    WorkspaceFixture(
        slug="web-inventory-polish",
        display_name="web workspace inventory polish",
        git_branch="ui/workspace-inventory-polish",
        target_key="personal_cloud",
        owner_scope="personal",
        origin="manual_web",
        origin_context={"kind": "human", "entrypoint": "web"},
        visibility="private",
        workspace_status="ready",
        session_status="running",
        session_title="iterate on workspace inventory UI",
        minutes_ago=3,
        source_agent_kind="codex",
        prompt="Make the workspace inventory feel closer to the desktop list.",
        response="I wired the shared inventory component and mapped cloud workspace summaries into source, owner, location, and status groups.",
    ),
    WorkspaceFixture(
        slug="local-mcp-loader",
        display_name="local MCP plugin loader cleanup",
        git_branch="mcp/loader-v2-faux",
        target_key="local_desktop",
        owner_scope="personal",
        origin="manual_desktop",
        origin_context={"kind": "human", "entrypoint": "desktop"},
        visibility="private",
        workspace_status="ready",
        session_status="running",
        session_title="hot reload plugin directories",
        minutes_ago=7,
        source_agent_kind="claude",
        prompt="Refactor the MCP plugin loader so local plugin changes show up live.",
        response="I found the registry invalidation path and started splitting watcher state from bundle materialization.",
    ),
    WorkspaceFixture(
        slug="bulk-delete-dashboard",
        display_name="bulk delete on dashboard",
        git_branch="feat/bulk-delete-faux",
        target_key="personal_cloud",
        owner_scope="personal",
        origin="manual_web",
        origin_context={"kind": "human", "entrypoint": "web"},
        visibility="private",
        workspace_status="ready",
        session_status="ready_for_review",
        session_title="bulk delete ready for review",
        minutes_ago=12,
        source_agent_kind="codex",
        prompt="Add bulk delete to the workspace dashboard.",
        response="The UI uses shift-click selection, sends a single delete request, and keeps optimistic rollback on failure.",
    ),
    WorkspaceFixture(
        slug="sentry-worker-claim",
        display_name="sentry-2341 null in worker.claim",
        git_branch="automation/sentry-2341-0badf00d1234",
        target_key="shared_cloud",
        owner_scope="organization",
        origin="automation",
        origin_context={"kind": "system", "entrypoint": "cloud"},
        visibility="shared_unclaimed",
        workspace_status="ready",
        session_status="ready_for_review",
        session_title="guard worker claim owner",
        minutes_ago=18,
        source_agent_kind="codex",
        prompt="Sentry alert #2341: null in worker.claim.",
        response="Patch ready. The null guard is in place and the regression test reproduces the original handoff failure.",
    ),
    WorkspaceFixture(
        slug="slack-dashboard-500",
        display_name="customer #1843 dashboard 500s",
        git_branch="fix/dashboard-500-faux",
        target_key="shared_cloud",
        owner_scope="organization",
        origin="slack",
        origin_context={"kind": "system", "entrypoint": "slack"},
        visibility="shared_unclaimed",
        workspace_status="error",
        session_status="running",
        session_title="dashboard 500 trace review",
        minutes_ago=22,
        source_agent_kind="claude",
        prompt="Slack thread: customer #1843 is seeing dashboard 500s.",
        response="I found the failing worker claim path, but the fix needs a choice between mutexing claim() or retry-with-jitter.",
        last_error="Faux blocker: needs human decision on concurrency strategy.",
    ),
    WorkspaceFixture(
        slug="mobile-login-regression",
        display_name="mobile login regression",
        git_branch="automation/mobile-login-a11ce5eed123",
        target_key="shared_cloud",
        owner_scope="organization",
        origin="automation",
        origin_context={"kind": "system", "entrypoint": "cloud"},
        visibility="shared_unclaimed",
        workspace_status="error",
        session_status="running",
        session_title="iOS refresh token mismatch",
        minutes_ago=28,
        source_agent_kind="codex",
        prompt="Automation found a mobile login regression.",
        response="The repro is in the iOS keychain refresh path. The deeper issue is a token TTL mismatch between app and server.",
        last_error="Faux blocker: token TTL mismatch needs product decision.",
    ),
    WorkspaceFixture(
        slug="nightly-skill-index",
        display_name="nightly skill index rebuild",
        git_branch="automation/nightly-skills-deadbeefcafe",
        target_key="shared_cloud",
        owner_scope="organization",
        origin="automation",
        origin_context={"kind": "system", "entrypoint": "cloud"},
        visibility="shared_unclaimed",
        workspace_status="materializing",
        session_status="queued",
        session_title="nightly skill index rebuild",
        minutes_ago=31,
        source_agent_kind="codex",
        prompt="Nightly automation: rebuild the skill index.",
        response="Queued. The faux run is waiting on a shared cloud slot before materializing the workspace.",
    ),
    WorkspaceFixture(
        slug="cloud-auth-v2-review",
        display_name="feat/cloud-auth-v2 review",
        git_branch="feat/cloud-auth-v2-faux",
        target_key="shared_cloud",
        owner_scope="organization",
        origin="slack",
        origin_context={"kind": "system", "entrypoint": "slack"},
        visibility="claimed",
        claim_source_kind="slack",
        workspace_status="ready",
        session_status="review",
        session_title="review refresh-token rotation",
        minutes_ago=64,
        source_agent_kind="claude",
        prompt="Maya asked for a review of cloud-auth-v2 from Slack.",
        response="Two concerns: refresh TTL mismatch and missing coverage for concurrent refresh across devices.",
    ),
    WorkspaceFixture(
        slug="slash-command-api",
        display_name="slack bot /prolif command",
        git_branch="feat/slash-command-faux",
        target_key="shared_cloud",
        owner_scope="organization",
        origin="cowork_api",
        origin_context={"kind": "api", "entrypoint": "api"},
        visibility="claimed",
        claim_source_kind="api",
        workspace_status="ready",
        session_status="running",
        session_title="wire slash command resolver",
        minutes_ago=360,
        source_agent_kind="codex",
        prompt="Ship the /prolif slash command from the API path.",
        response="The Slack app manifest is staged and the workspace resolver is wired into the command handler.",
    ),
    WorkspaceFixture(
        slug="ssh-litellm-gateway",
        display_name="api auth gateway spike",
        git_branch="spike/litellm-gateway-faux",
        target_key="ssh_popos",
        owner_scope="personal",
        origin="manual_web",
        origin_context={"kind": "human", "entrypoint": "web"},
        visibility="private",
        workspace_status="ready",
        session_status="ended",
        session_title="LiteLLM gateway spike notes",
        minutes_ago=180,
        source_agent_kind="codex",
        prompt="Spike a LiteLLM proxy as the agent auth gateway.",
        response="The spike is viable. Routing works for Anthropic, OpenAI, and DeepSeek; token accounting needs a tighter follow-up.",
    ),
    WorkspaceFixture(
        slug="shared-sandbox-settings",
        display_name="shared sandbox settings cleanup",
        git_branch="ui/shared-sandbox-settings-faux",
        target_key="self_hosted",
        owner_scope="organization",
        origin="manual_web",
        origin_context={"kind": "human", "entrypoint": "web"},
        visibility="claimed",
        claim_source_kind="manual",
        workspace_status="ready",
        session_status="idle",
        session_title="separate shared powers from plugins",
        minutes_ago=210,
        source_agent_kind="claude",
        prompt="Move shared sandbox MCP and agent auth configuration out of the plugins page.",
        response="The proposed shape puts personal connection management in MCP/Agent Auth, and shared exposure in the shared sandbox settings page.",
    ),
    WorkspaceFixture(
        slug="docs-readme-rewrite",
        display_name="readme rewrite pass",
        git_branch="docs/readme-faux",
        target_key="local_desktop",
        owner_scope="personal",
        origin="manual_desktop",
        origin_context={"kind": "human", "entrypoint": "desktop"},
        visibility="private",
        workspace_status="ready",
        session_status="ended",
        session_title="IAE positioning README",
        minutes_ago=2880,
        source_agent_kind="claude",
        prompt="Rewrite the README and lead with IAE positioning.",
        response="Done. The top section now introduces Proliferate as an Integrated Agent Environment.",
    ),
)


def profile_database_url(profile: str) -> str:
    if not PROFILE_NAME_PATTERN.fullmatch(profile):
        raise ValueError(
            "Profile names must use lowercase letters, numbers, hyphens, or underscores.",
        )
    normalized_profile = profile.replace("-", "_")
    database_name = f"proliferate_dev_{normalized_profile}"
    return (
        f"postgresql+asyncpg://{quote(DEFAULT_DB_USER, safe='')}:"
        f"{quote(DEFAULT_DB_PASSWORD, safe='')}@"
        f"{DEFAULT_DB_HOST}:{DEFAULT_DB_PORT}/{quote(database_name, safe='')}"
    )


def workspace_status_detail(fixture: WorkspaceFixture) -> str:
    if fixture.workspace_status == "ready":
        return "Faux workspace ready"
    if fixture.workspace_status == "materializing":
        return "Faux workspace materializing"
    if fixture.workspace_status == "pending":
        return "Faux workspace pending"
    if fixture.workspace_status == "error":
        return fixture.last_error or "Faux workspace blocked"
    return "Faux workspace"


def timestamp(minutes_ago: int) -> datetime:
    return now() - timedelta(minutes=minutes_ago)


def now() -> datetime:
    return datetime.now(UTC)
