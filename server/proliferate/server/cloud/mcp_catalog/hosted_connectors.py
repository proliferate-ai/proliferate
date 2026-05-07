from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.builders import _bearer, _secret_field
from proliferate.server.cloud.mcp_catalog.types import (
    CatalogEntry,
    HeaderTemplate,
    HttpLaunchTemplate,
    StaticUrl,
)

HOSTED_CONNECTOR_CATALOG: tuple[CatalogEntry, ...] = (
    CatalogEntry(
        id="sentry",
        version=1,
        name="Sentry",
        one_liner="Inspect Sentry issues, traces, releases, and debugging context.",
        description=(
            "Use Sentry to inspect issues, traces, releases, and project context "
            "through Sentry's hosted MCP server."
        ),
        docs_url="https://github.com/getsentry/sentry-mcp",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="dcr",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.sentry.dev/mcp"),
            display_url="https://mcp.sentry.dev/mcp",
        ),
        server_name_base="sentry",
        icon_id="sentry",
        capabilities=(
            "Inspect Sentry issues and events",
            "Review traces and release context",
            "Bring production error context into debugging sessions",
        ),
    ),
    CatalogEntry(
        id="cloudflare_docs",
        version=1,
        name="Cloudflare Docs",
        one_liner="Search official Cloudflare documentation.",
        description=(
            "Use Cloudflare Docs to search official Cloudflare documentation and API "
            "references through Cloudflare's hosted MCP docs server."
        ),
        docs_url=(
            "https://developers.cloudflare.com/agents/model-context-protocol/"
            "mcp-servers-for-cloudflare/"
        ),
        availability="universal",
        transport="http",
        auth_kind="none",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://docs.mcp.cloudflare.com/mcp"),
            display_url="https://docs.mcp.cloudflare.com/mcp",
        ),
        server_name_base="cloudflare_docs",
        icon_id="cloudflare",
        capabilities=(
            "Search official Cloudflare docs",
            "Retrieve Cloudflare API and product references",
            "Answer Cloudflare implementation questions without account access",
        ),
    ),
    CatalogEntry(
        id="gitlab",
        version=1,
        name="GitLab",
        one_liner="Search GitLab projects, merge requests, issues, and pipelines.",
        description=(
            "Use GitLab to inspect GitLab.com projects, merge requests, issues, "
            "commits, and pipeline context through GitLab's hosted MCP server."
        ),
        docs_url="https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="dcr",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://gitlab.com/api/v4/mcp"),
            display_url="https://gitlab.com/api/v4/mcp",
        ),
        server_name_base="gitlab",
        icon_id="gitlab",
        capabilities=(
            "Search projects and repositories",
            "Inspect merge requests and issues",
            "Read commits and pipeline context",
        ),
    ),
    CatalogEntry(
        id="render",
        version=1,
        name="Render",
        one_liner="Inspect Render services, deploys, and logs.",
        description=(
            "Use Render to inspect services, deploys, logs, and infrastructure "
            "context through Render's hosted MCP server."
        ),
        docs_url="https://render.com/docs/mcp-server",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.render.com/mcp"),
            display_url="https://mcp.render.com/mcp",
            headers=(_bearer("api_key"),),
        ),
        server_name_base="render",
        icon_id="render",
        secret_fields=(
            _secret_field(
                "api_key",
                "API key",
                "rnd_...",
                "Create a Render API key with the narrowest access needed for MCP inspection.",
                "Open Render account settings, create or copy an API key, and paste it here.",
                "rnd_",
            ),
        ),
        capabilities=(
            "List Render services",
            "Inspect deploys and logs",
            "Review service and environment-group context",
        ),
    ),
    CatalogEntry(
        id="neon",
        version=1,
        name="Neon Postgres",
        one_liner="Inspect Neon projects, branches, and databases in read-only mode.",
        description=(
            "Use Neon to inspect Neon projects, database branches, and schema context "
            "through Neon's hosted MCP server. Proliferate starts Neon MCP in read-only mode."
        ),
        docs_url="https://neon.com/docs/ai/neon-mcp-server",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.neon.tech/mcp"),
            display_url="https://mcp.neon.tech/mcp",
            headers=(
                _bearer("api_key"),
                HeaderTemplate("x-read-only", "true"),
            ),
        ),
        server_name_base="neon",
        icon_id="neon",
        secret_fields=(
            _secret_field(
                "api_key",
                "API key",
                "Paste your Neon API key",
                "Use a Neon API key from a test or least-privileged account.",
                "Open Neon account settings, create or copy an API key, and paste it here.",
            ),
        ),
        capabilities=(
            "List Neon projects and branches",
            "Inspect database/schema context",
            "Run read-only Neon MCP tools",
        ),
    ),
    CatalogEntry(
        id="huggingface",
        version=1,
        name="Hugging Face",
        one_liner="Search models, datasets, Spaces, and Hub metadata.",
        description=(
            "Use Hugging Face to search and inspect models, datasets, Spaces, model "
            "cards, and Hub metadata through Hugging Face's hosted MCP server."
        ),
        docs_url="https://huggingface.co/docs/hub/en/hf-mcp-server",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://huggingface.co/mcp"),
            display_url="https://huggingface.co/mcp",
            headers=(_bearer("hf_token"),),
        ),
        server_name_base="huggingface",
        icon_id="huggingface",
        secret_fields=(
            _secret_field(
                "hf_token",
                "Access token",
                "hf_...",
                "Use a fine-grained Hugging Face access token with read permissions.",
                (
                    "Open Hugging Face access tokens, create or copy a fine-grained "
                    "read token, and paste it here."
                ),
                "hf_",
            ),
        ),
        capabilities=(
            "Search models and datasets",
            "Inspect model cards and Space metadata",
            "Retrieve Hub context for implementation research",
        ),
    ),
)
