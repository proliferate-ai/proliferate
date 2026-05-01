from __future__ import annotations

from proliferate.config import settings
from proliferate.server.cloud.mcp_catalog.builders import (
    _bearer,
    _secret_field,
    _secret_query,
    _setting_option,
)
from proliferate.server.cloud.mcp_catalog.hosted_connectors import HOSTED_CONNECTOR_CATALOG
from proliferate.server.cloud.mcp_catalog.renderer import (
    connector_supports_target,
    normalize_settings,
    parse_settings,
    render_http_launch,
    render_oauth_resource_url,
    validate_secret_fields,
    validate_settings,
)
from proliferate.server.cloud.mcp_catalog.types import (
    ArgTemplate,
    CatalogConfigurationError,
    CatalogEntry,
    CatalogSecretField,
    CatalogSettingField,
    CatalogSettingOption,
    EnvTemplate,
    HeaderTemplate,
    HttpLaunchTemplate,
    QueryTemplate,
    StaticUrl,
    UrlBySetting,
    UrlVariant,
)

CATALOG_VERSION = "2026-04-30.1"
GOOGLE_WORKSPACE_MCP_PACKAGE = "workspace-mcp==1.20.1"

__all__ = [
    "ArgTemplate",
    "CATALOG_VERSION",
    "CONNECTOR_CATALOG",
    "CatalogConfigurationError",
    "CatalogEntry",
    "CatalogSecretField",
    "CatalogSettingField",
    "CatalogSettingOption",
    "EnvTemplate",
    "HeaderTemplate",
    "HttpLaunchTemplate",
    "QueryTemplate",
    "StaticUrl",
    "UrlBySetting",
    "UrlVariant",
    "get_catalog_entry",
    "build_connector_catalog",
    "connector_supports_target",
    "normalize_settings",
    "parse_settings",
    "render_http_launch",
    "render_oauth_resource_url",
    "validate_secret_fields",
    "validate_settings",
]


BASE_CONNECTOR_CATALOG: tuple[CatalogEntry, ...] = (
    CatalogEntry(
        id="github",
        version=1,
        name="GitHub",
        one_liner="Search repositories, issues, pull requests, and code on GitHub.",
        description=(
            "Use GitHub to inspect repositories, review pull requests, follow issues, "
            "and pull in docs without leaving Proliferate."
        ),
        docs_url=(
            "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/"
            "managing-your-personal-access-tokens"
        ),
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://api.githubcopilot.com/mcp/"),
            display_url="https://api.githubcopilot.com/mcp/",
            headers=(_bearer("personal_access_token"),),
        ),
        server_name_base="github",
        icon_id="github",
        secret_fields=(
            _secret_field(
                "personal_access_token",
                "Personal access token",
                "github_pat_...",
                "Use a fine-grained personal access token.",
                (
                    "Open GitHub Settings, create a fine-grained personal access token, "
                    "copy it, and paste it here."
                ),
                "github_pat_",
            ),
        ),
        capabilities=(
            "Search code across repositories you can access",
            "Read pull requests, reviews, and discussions",
            "Browse issues, labels, and milestones",
            "Pull in README and doc content from repos",
        ),
    ),
    CatalogEntry(
        id="context7",
        version=1,
        name="Context7",
        one_liner="Pull current library docs into every session.",
        description=(
            "Use Context7 when Proliferate needs current, version-specific documentation "
            "and code examples for the libraries in your project."
        ),
        docs_url="https://context7.com/docs/howto/api-keys",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.context7.com/mcp"),
            display_url="https://mcp.context7.com/mcp",
            headers=(_bearer("api_key"),),
        ),
        server_name_base="context7",
        icon_id="context7",
        secret_fields=(
            _secret_field(
                "api_key",
                "API key",
                "ctx7sk-...",
                "Create a key in your Context7 dashboard.",
                "Open the Context7 dashboard, create an API key, copy it, and paste it here.",
                "ctx7sk-",
            ),
        ),
        capabilities=(
            "Look up current, version-specific library docs",
            "Pull example snippets from official sources",
            "Resolve ambiguous API usage with live references",
        ),
    ),
    CatalogEntry(
        id="exa",
        version=1,
        name="Exa",
        one_liner="Search the web and code context with Exa.",
        description=(
            "Use Exa when Proliferate needs fast web, docs, and code context from "
            "Exa's search infrastructure."
        ),
        docs_url="https://docs.exa.ai/reference/exa-mcp",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.exa.ai/mcp"),
            display_url="https://mcp.exa.ai/mcp",
            query=(_secret_query("exaApiKey", "api_key"),),
        ),
        server_name_base="exa",
        icon_id="exa",
        secret_fields=(
            _secret_field(
                "api_key",
                "API key",
                "Paste your Exa API key",
                "Create or copy an API key from your Exa dashboard.",
                "Open your Exa dashboard, create or copy an API key, and paste it here.",
            ),
        ),
        capabilities=(
            "Search the web for current information",
            "Pull concise context from docs and code examples",
            "Research unfamiliar APIs and implementation patterns",
        ),
    ),
    CatalogEntry(
        id="tavily",
        version=1,
        name="Tavily",
        one_liner="Search, extract, and research the web.",
        description=(
            "Use Tavily when Proliferate needs web search plus extraction and crawl "
            "tools for deeper research tasks."
        ),
        docs_url="https://docs.tavily.com/guides/quickstart",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.tavily.com/mcp"),
            display_url="https://mcp.tavily.com/mcp",
            headers=(_bearer("api_key"),),
        ),
        server_name_base="tavily",
        icon_id="tavily",
        secret_fields=(
            _secret_field(
                "api_key",
                "API key",
                "tvly-...",
                "Get a free key from Tavily.",
                "Open the Tavily dashboard, copy one of your API keys, and paste it here.",
                "tvly-",
            ),
        ),
        capabilities=(
            "Run focused web searches",
            "Extract clean text from pages",
            "Crawl linked pages for deeper research",
        ),
    ),
    CatalogEntry(
        id="posthog",
        version=1,
        name="PostHog",
        one_liner="Inspect PostHog product analytics, flags, and event context.",
        description=(
            "Use PostHog to query product analytics, feature flags, events, and "
            "observability context through a selected PostHog region."
        ),
        docs_url="https://posthog.com/docs/model-context-protocol",
        availability="universal",
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=UrlBySetting(
                setting_id="region",
                variants=(
                    UrlVariant("us", "https://mcp.posthog.com/mcp"),
                    UrlVariant("eu", "https://mcp-eu.posthog.com/mcp"),
                ),
            ),
            display_url="https://mcp.posthog.com/mcp",
            headers=(
                _bearer("apiKey"),
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
        ),
        server_name_base="posthog",
        icon_id="posthog",
        secret_fields=(
            _secret_field(
                "apiKey",
                "Project API key",
                "phx_...",
                "Create or copy a project API key from your PostHog settings.",
                "Open PostHog project settings, copy a project API key, and paste it here.",
                "phx_",
            ),
        ),
        settings_fields=(
            CatalogSettingField(
                id="region",
                label="Region",
                kind="select",
                required=True,
                helper_text="Choose the PostHog region that hosts your project.",
                default_value="us",
                options=(
                    _setting_option("us", "US"),
                    _setting_option("eu", "EU"),
                ),
                affects_url=True,
            ),
            CatalogSettingField(
                id="organizationId",
                label="Organization ID",
                kind="string",
                placeholder="Optional PostHog organization ID",
                helper_text="Optional. Pins the MCP server to one PostHog organization.",
            ),
            CatalogSettingField(
                id="projectId",
                label="Project ID",
                kind="string",
                placeholder="Optional PostHog project ID",
                helper_text="Optional. Pins the MCP server to one PostHog project.",
            ),
            CatalogSettingField(
                id="features",
                label="Features",
                kind="string",
                placeholder="Optional comma-separated feature set",
                helper_text="Optional. Limits PostHog MCP features exposed to the session.",
            ),
            CatalogSettingField(
                id="tools",
                label="Tools",
                kind="string",
                placeholder="Optional comma-separated tool names",
                helper_text="Optional. Limits PostHog MCP tools exposed to the session.",
            ),
        ),
        capabilities=(
            "Query product analytics and event context",
            "Inspect feature flags and experiments",
            "Bring PostHog observability into debugging sessions",
        ),
    ),
    *HOSTED_CONNECTOR_CATALOG,
    CatalogEntry(
        id="linear",
        version=1,
        name="Linear",
        one_liner="Search issues, projects, and teams in Linear.",
        description="Use Linear to inspect issues, projects, cycles, and team state.",
        docs_url="https://linear.app/docs/mcp",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="dcr",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.linear.app/mcp"),
            display_url="https://mcp.linear.app/mcp",
        ),
        server_name_base="linear",
        icon_id="linear",
        capabilities=(
            "Search issues, projects, and cycles",
            "Inspect team workloads and states",
            "Follow up on ticket status and ownership",
        ),
    ),
    CatalogEntry(
        id="slack",
        version=1,
        name="Slack",
        one_liner="Search Slack context and draft workspace follow-ups.",
        description=(
            "Use Slack to search workspace messages, channels, files, users, and "
            "prepare Slack follow-ups through the official hosted MCP server."
        ),
        docs_url="https://docs.slack.dev/ai/slack-mcp-server/",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="static",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.slack.com/mcp"),
            display_url="https://mcp.slack.com/mcp",
        ),
        server_name_base="slack",
        icon_id="slack",
        capabilities=(
            "Search messages, files, users, and channels",
            "Read channel and thread history with authorized scopes",
            "Draft and send Slack messages when granted write access",
            "Read and manage Slack canvases when granted canvas scopes",
        ),
    ),
    CatalogEntry(
        id="supabase",
        version=1,
        name="Supabase",
        one_liner="Inspect and manage a single Supabase project.",
        description=(
            "Use Supabase to inspect schema, SQL, storage, and project configuration "
            "for one project at a time."
        ),
        docs_url="https://supabase.com/docs/guides/getting-started/mcp",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="dcr",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.supabase.com/mcp"),
            display_url="https://mcp.supabase.com/mcp",
            query=(
                QueryTemplate("project_ref", "{settings.projectRef}"),
                QueryTemplate("read_only", "{settings.readOnly}"),
            ),
        ),
        server_name_base="supabase",
        icon_id="supabase",
        settings_fields=(
            CatalogSettingField(
                id="projectRef",
                label="Project ref",
                kind="string",
                required=True,
                placeholder="abcd1234",
                helper_text="Choose the Supabase project to expose to this session.",
                affects_url=True,
            ),
            CatalogSettingField(
                id="readOnly",
                label="Read-only mode",
                kind="boolean",
                required=True,
                helper_text="Start in read-only mode unless you explicitly need write access.",
                default_value=True,
                affects_url=True,
            ),
        ),
        capabilities=(
            "Inspect schema, tables, and views",
            "Run SQL against a selected project",
            "Browse storage buckets and project config",
            "Start read-only until you explicitly open write access",
        ),
    ),
    CatalogEntry(
        id="notion",
        version=1,
        name="Notion",
        one_liner="Read and update selected pages and databases in Notion.",
        description=(
            "Use Notion to search and work with the pages and databases you authorize "
            "during the browser consent flow."
        ),
        docs_url="https://developers.notion.com/guides/mcp/get-started-with-mcp",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="dcr",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.notion.com/mcp"),
            display_url="https://mcp.notion.com/mcp",
        ),
        server_name_base="notion",
        icon_id="notion",
        capabilities=(
            "Search authorized pages and databases",
            "Read and update selected records",
            "Navigate the workspaces you grant access to",
        ),
    ),
    CatalogEntry(
        id="filesystem",
        version=1,
        name="Filesystem",
        one_liner="Read and write files inside the current workspace.",
        description=(
            "Use the Filesystem server when Proliferate should inspect or edit files "
            "directly through MCP against the active workspace path."
        ),
        docs_url="https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
        availability="local_only",
        transport="stdio",
        auth_kind="none",
        command="mcp-server-filesystem",
        args=(ArgTemplate(kind="workspace_path"),),
        server_name_base="filesystem",
        icon_id="filesystem",
        capabilities=(
            "Read files inside the active workspace",
            "Create new files in the workspace",
            "Make targeted edits without leaving the session",
        ),
    ),
    CatalogEntry(
        id="playwright",
        version=1,
        name="Playwright",
        one_liner="Drive and inspect the browser with Playwright tools.",
        description=(
            "Use Playwright when Proliferate needs browser automation, DOM inspection, "
            "and page interaction over MCP."
        ),
        docs_url="https://github.com/microsoft/playwright-mcp",
        availability="local_only",
        transport="stdio",
        auth_kind="none",
        command="playwright-mcp",
        server_name_base="playwright",
        icon_id="playwright",
        capabilities=(
            "Launch a headless browser session",
            "Click, type, and navigate pages",
            "Capture DOM state and page snapshots",
        ),
    ),
)

# Backwards-compatible static catalog for tests and code that only needs the
# deployment-independent entries. Runtime paths must call build_connector_catalog().
CONNECTOR_CATALOG = BASE_CONNECTOR_CATALOG


def _google_workspace_catalog_entry() -> CatalogEntry | None:
    if not settings.cloud_mcp_google_workspace_enabled:
        return None
    client_id = settings.cloud_mcp_google_workspace_oauth_client_id.strip()
    client_secret = settings.cloud_mcp_google_workspace_oauth_client_secret.strip()
    if not client_id or not client_secret:
        return None
    return CatalogEntry(
        id="gmail",
        version=1,
        name="Gmail",
        one_liner="Search and read Gmail messages locally through Google Workspace MCP.",
        description=(
            "Use Gmail when Proliferate needs read-only access to mail context. "
            "OAuth tokens and Gmail content stay on this desktop."
        ),
        docs_url="https://developers.google.com/workspace/gmail/api/auth/scopes",
        availability="local_only",
        transport="stdio",
        auth_kind="none",
        setup_kind="local_oauth",
        command="uvx",
        args=(
            ArgTemplate(kind="static", value="--from"),
            ArgTemplate(kind="static", value=GOOGLE_WORKSPACE_MCP_PACKAGE),
            ArgTemplate(kind="static", value="workspace-mcp"),
            ArgTemplate(kind="static", value="--transport"),
            ArgTemplate(kind="static", value="stdio"),
            ArgTemplate(kind="static", value="--permissions"),
            ArgTemplate(kind="static", value="gmail:readonly"),
            ArgTemplate(kind="static", value="--tool-tier"),
            ArgTemplate(kind="static", value="core"),
        ),
        env=(
            EnvTemplate(name="GOOGLE_OAUTH_CLIENT_ID", kind="static", value=client_id),
            EnvTemplate(
                name="GOOGLE_OAUTH_CLIENT_SECRET",
                kind="static",
                value=client_secret,
            ),
            EnvTemplate(name="OAUTHLIB_INSECURE_TRANSPORT", kind="static", value="1"),
        ),
        settings_fields=(
            CatalogSettingField(
                id="userGoogleEmail",
                label="Google account email",
                kind="string",
                required=True,
                placeholder="name@example.com",
                helper_text="The Gmail account to authorize on this desktop.",
            ),
        ),
        server_name_base="gmail",
        icon_id="gmail",
        capabilities=(
            "Search Gmail messages",
            "Read message and thread content",
            "Use local-only Google OAuth credentials",
        ),
    )


def build_connector_catalog() -> tuple[CatalogEntry, ...]:
    dynamic_entries = tuple(
        entry for entry in (_google_workspace_catalog_entry(),) if entry is not None
    )
    return (*BASE_CONNECTOR_CATALOG, *dynamic_entries)


def get_catalog_entry(catalog_entry_id: str) -> CatalogEntry | None:
    return {entry.id: entry for entry in build_connector_catalog()}.get(catalog_entry_id)
