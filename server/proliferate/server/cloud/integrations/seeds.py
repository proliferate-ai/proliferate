"""Code-defined seed integration registry.

``SEED_DEFINITIONS`` is the authoritative list of built-in ("seed") connectors.
``sync_seed_definitions`` reconciles them into ``cloud_integration_definition``
(``source='seed'``), matched by namespace, without ever touching org-custom rows.

Ported from the old MCP catalog
(``server/proliferate/server/cloud/mcp_catalog/catalog.py`` and
``domain/hosted_connectors.py`` as of commit ``4b54c9f2b``). Old ``auth_kind``
values are normalized: ``secret`` -> ``api_key``, ``oauth`` -> ``oauth2``,
``none`` -> ``none``.

Follow-up: the old ``gmail`` stdio/local-only dynamic entry (Google Workspace
MCP) is intentionally not ported yet; it needs the stdio launch + local OAuth
setup path and gated config, which land in a later PR.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations.definitions import (
    IntegrationDefinitionRecord,
    archive_seed_definitions_not_in,
    upsert_seed_definition,
)
from proliferate.server.cloud.integrations.config import (
    HeaderTemplate,
    IntegrationConfig,
    QueryTemplate,
    SecretField,
    SettingField,
    SettingOption,
    StaticUrl,
    UrlBySetting,
    serialize_definition_config,
)

logger = logging.getLogger(__name__)

SeedAuthKind = Literal["oauth2", "api_key", "none"]
SeedOAuthClientMode = Literal["dcr", "static"]


@dataclass(frozen=True)
class SeedDefinition:
    namespace: str
    display_name: str
    description: str
    auth_kind: SeedAuthKind
    oauth_client_mode: SeedOAuthClientMode | None
    config: IntegrationConfig
    enabled_by_default: bool = True


# --------------------------------------------------------------------------- #
# Builders (mirror the old domain/builders.py helpers)
# --------------------------------------------------------------------------- #


def _bearer_header(secret_field_id: str) -> HeaderTemplate:
    return HeaderTemplate("Authorization", f"Bearer {{secret.{secret_field_id}}}")


def _oauth_bearer_header() -> HeaderTemplate:
    return HeaderTemplate("Authorization", "Bearer {secret.accessToken}", optional=True)


def _secret_query(parameter_name: str, secret_field_id: str) -> QueryTemplate:
    return QueryTemplate(parameter_name, f"{{secret.{secret_field_id}}}")


def _secret_field(
    field_id: str,
    label: str,
    placeholder: str,
    helper_text: str,
    prefix_hint: str | None = None,
) -> SecretField:
    return SecretField(
        id=field_id,
        label=label,
        placeholder=placeholder,
        helper_text=helper_text,
        prefix_hint=prefix_hint,
    )


# --------------------------------------------------------------------------- #
# Seed registry
# --------------------------------------------------------------------------- #

SEED_DEFINITIONS: tuple[SeedDefinition, ...] = (
    SeedDefinition(
        namespace="context7",
        display_name="Context7",
        description=(
            "Use Context7 when Proliferate needs current, version-specific documentation "
            "and code examples for the libraries in your project."
        ),
        auth_kind="api_key",
        oauth_client_mode=None,
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.context7.com/mcp"),
            display_url="https://mcp.context7.com/mcp",
            headers=(_bearer_header("api_key"),),
            cloud_secret_sync=True,
            secret_fields=(
                _secret_field(
                    "api_key",
                    "API key",
                    "ctx7sk-...",
                    "Create a key in your Context7 dashboard.",
                    "ctx7sk-",
                ),
            ),
        ),
    ),
    SeedDefinition(
        namespace="exa",
        display_name="Exa",
        description=(
            "Use Exa when Proliferate needs fast web, docs, and code context from "
            "Exa's search infrastructure."
        ),
        auth_kind="api_key",
        oauth_client_mode=None,
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.exa.ai/mcp"),
            display_url="https://mcp.exa.ai/mcp",
            query=(_secret_query("exaApiKey", "api_key"),),
            cloud_secret_sync=True,
            secret_fields=(
                _secret_field(
                    "api_key",
                    "API key",
                    "Paste your Exa API key",
                    "Create or copy an API key from your Exa dashboard.",
                ),
            ),
        ),
    ),
    SeedDefinition(
        namespace="tavily",
        display_name="Tavily",
        description=(
            "Use Tavily when Proliferate needs web search plus extraction and crawl "
            "tools for deeper research tasks."
        ),
        auth_kind="api_key",
        oauth_client_mode=None,
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.tavily.com/mcp"),
            display_url="https://mcp.tavily.com/mcp",
            headers=(_bearer_header("api_key"),),
            cloud_secret_sync=True,
            secret_fields=(
                _secret_field(
                    "api_key",
                    "API key",
                    "tvly-...",
                    "Get a free key from Tavily.",
                    "tvly-",
                ),
            ),
        ),
    ),
    SeedDefinition(
        namespace="posthog",
        display_name="PostHog",
        description=(
            "Use PostHog to query product analytics, feature flags, events, and "
            "observability context through PostHog's hosted OAuth MCP server."
        ),
        auth_kind="oauth2",
        oauth_client_mode="dcr",
        config=IntegrationConfig(
            transport="http",
            url=UrlBySetting(
                setting_id="region",
                variants={
                    "us": "https://mcp.posthog.com/mcp",
                    "eu": "https://mcp-eu.posthog.com/mcp",
                },
                default="https://mcp.posthog.com/mcp",
            ),
            display_url="https://mcp.posthog.com/mcp",
            headers=(
                _oauth_bearer_header(),
                HeaderTemplate(
                    "x-posthog-organization-id",
                    "{settings.organizationId}",
                    optional=True,
                ),
                HeaderTemplate("x-posthog-project-id", "{settings.projectId}", optional=True),
            ),
            query=(
                QueryTemplate("features", "{settings.features}", optional=True),
                QueryTemplate("tools", "{settings.tools}", optional=True),
            ),
            settings_fields=(
                SettingField(
                    id="region",
                    label="Region",
                    kind="select",
                    required=True,
                    default="us",
                    options=(
                        SettingOption("us", "US"),
                        SettingOption("eu", "EU"),
                    ),
                    affects_url=True,
                ),
                SettingField(id="organizationId", label="Organization ID", kind="string"),
                SettingField(id="projectId", label="Project ID", kind="string"),
                SettingField(id="features", label="Features", kind="string"),
                SettingField(id="tools", label="Tools", kind="string"),
            ),
        ),
    ),
    SeedDefinition(
        namespace="sentry",
        display_name="Sentry",
        description=(
            "Use Sentry to inspect issues, events, stack traces, projects, releases, "
            "and team context through Sentry's hosted OAuth MCP server."
        ),
        auth_kind="oauth2",
        oauth_client_mode="dcr",
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.sentry.dev/mcp"),
            display_url="https://mcp.sentry.dev/mcp",
            headers=(_oauth_bearer_header(),),
        ),
    ),
    SeedDefinition(
        namespace="axiom",
        display_name="Axiom",
        description=(
            "Use Axiom to query datasets, analyze traces, inspect logs, and review "
            "monitor context through Axiom's hosted OAuth MCP server."
        ),
        auth_kind="oauth2",
        oauth_client_mode="dcr",
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.axiom.co/mcp"),
            display_url="https://mcp.axiom.co/mcp",
            headers=(_oauth_bearer_header(),),
        ),
    ),
    SeedDefinition(
        namespace="linear",
        display_name="Linear",
        description="Use Linear to inspect issues, projects, cycles, and team state.",
        auth_kind="oauth2",
        oauth_client_mode="dcr",
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.linear.app/mcp"),
            display_url="https://mcp.linear.app/mcp",
            headers=(_oauth_bearer_header(),),
        ),
    ),
    SeedDefinition(
        namespace="slack",
        display_name="Slack",
        description=(
            "Use Slack to search workspace messages, channels, files, users, and "
            "prepare Slack follow-ups through the official hosted MCP server."
        ),
        auth_kind="oauth2",
        oauth_client_mode="static",
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.slack.com/mcp"),
            display_url="https://mcp.slack.com/mcp",
            headers=(_oauth_bearer_header(),),
        ),
    ),
    SeedDefinition(
        namespace="supabase",
        display_name="Supabase",
        description=(
            "Use Supabase to inspect schema, SQL, storage, and project configuration "
            "for one project at a time."
        ),
        auth_kind="oauth2",
        oauth_client_mode="dcr",
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.supabase.com/mcp"),
            display_url="https://mcp.supabase.com/mcp",
            headers=(_oauth_bearer_header(),),
            query=(
                QueryTemplate("project_ref", "{settings.projectRef}"),
                QueryTemplate("read_only", "{settings.readOnly}"),
            ),
            settings_fields=(
                SettingField(
                    id="projectRef",
                    label="Project ref",
                    kind="string",
                    required=True,
                    affects_url=True,
                ),
                SettingField(
                    id="readOnly",
                    label="Read-only mode",
                    kind="boolean",
                    required=True,
                    default=True,
                    affects_url=True,
                ),
            ),
        ),
    ),
    SeedDefinition(
        namespace="notion",
        display_name="Notion",
        description=(
            "Use Notion to search and work with the pages and databases you authorize "
            "during the browser consent flow."
        ),
        auth_kind="oauth2",
        oauth_client_mode="dcr",
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.notion.com/mcp"),
            display_url="https://mcp.notion.com/mcp",
            headers=(_oauth_bearer_header(),),
        ),
    ),
    SeedDefinition(
        namespace="gitlab",
        display_name="GitLab",
        description=(
            "Use GitLab to inspect GitLab.com projects, merge requests, issues, "
            "commits, and pipeline context through GitLab's hosted MCP server."
        ),
        auth_kind="oauth2",
        oauth_client_mode="dcr",
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://gitlab.com/api/v4/mcp"),
            display_url="https://gitlab.com/api/v4/mcp",
            headers=(_oauth_bearer_header(),),
        ),
    ),
    SeedDefinition(
        namespace="render",
        display_name="Render",
        description=(
            "Use Render to inspect services, deploys, logs, and infrastructure "
            "context through Render's hosted MCP server."
        ),
        auth_kind="api_key",
        oauth_client_mode=None,
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.render.com/mcp"),
            display_url="https://mcp.render.com/mcp",
            headers=(_bearer_header("api_key"),),
            cloud_secret_sync=True,
            secret_fields=(
                _secret_field(
                    "api_key",
                    "API key",
                    "rnd_...",
                    "Create a Render API key with the narrowest access needed for MCP inspection.",
                    "rnd_",
                ),
            ),
        ),
    ),
    SeedDefinition(
        namespace="neon",
        display_name="Neon Postgres",
        description=(
            "Use Neon to inspect Neon projects, database branches, and schema context "
            "through Neon's hosted MCP server. Proliferate starts Neon MCP in read-only mode."
        ),
        auth_kind="api_key",
        oauth_client_mode=None,
        config=IntegrationConfig(
            transport="http",
            url=StaticUrl("https://mcp.neon.tech/mcp"),
            display_url="https://mcp.neon.tech/mcp",
            headers=(
                _bearer_header("api_key"),
                HeaderTemplate("x-read-only", "true"),
            ),
            cloud_secret_sync=True,
            secret_fields=(
                _secret_field(
                    "api_key",
                    "API key",
                    "Paste your Neon API key",
                    "Use a Neon API key from a test or least-privileged account.",
                ),
            ),
        ),
    ),
)


async def sync_seed_definitions(db: AsyncSession) -> tuple[IntegrationDefinitionRecord, ...]:
    """Upsert every seed spec into ``cloud_integration_definition``.

    Idempotent: matches on ``source='seed'`` + namespace, updates the mutable
    seed fields, and leaves org-custom rows untouched. Seeds removed from
    ``SEED_DEFINITIONS`` are archived on sync; re-added seeds are unarchived.
    """
    records = []
    for spec in SEED_DEFINITIONS:
        records.append(
            await upsert_seed_definition(
                db,
                namespace=spec.namespace,
                display_name=spec.display_name,
                description=spec.description,
                auth_kind=spec.auth_kind,
                oauth_client_mode=spec.oauth_client_mode,
                config_json=serialize_definition_config(spec.config),
                enabled_by_default=spec.enabled_by_default,
            )
        )
    current_namespaces = frozenset(spec.namespace for spec in SEED_DEFINITIONS)
    archived = await archive_seed_definitions_not_in(db, current_namespaces)
    if archived:
        logger.info("Archived removed seed definitions: %s", ", ".join(archived))
    return tuple(records)
