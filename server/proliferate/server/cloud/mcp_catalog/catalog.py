from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlencode

ConnectorAvailability = Literal["universal", "local_only", "cloud_only"]
ConnectorTransport = Literal["http", "stdio"]
ConnectorAuthKind = Literal["secret", "oauth", "none"]
ConnectorAuthStyleKind = Literal["bearer", "header", "query"]

CATALOG_VERSION = "2026-04-20.1"


@dataclass(frozen=True)
class CatalogField:
    id: str
    label: str
    placeholder: str
    helper_text: str
    get_token_instructions: str
    prefix_hint: str | None = None


@dataclass(frozen=True)
class HttpAuthStyle:
    kind: ConnectorAuthStyleKind
    header_name: str | None = None
    parameter_name: str | None = None


@dataclass(frozen=True)
class ArgTemplate:
    kind: Literal["static", "workspace_path"]
    value: str | None = None


@dataclass(frozen=True)
class EnvTemplate:
    name: str
    kind: Literal["static", "field"]
    value: str | None = None
    field_id: str | None = None


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    version: int
    name: str
    one_liner: str
    description: str
    docs_url: str
    availability: ConnectorAvailability
    transport: ConnectorTransport
    auth_kind: ConnectorAuthKind
    server_name_base: str
    icon_id: str
    required_fields: tuple[CatalogField, ...]
    capabilities: tuple[str, ...]
    cloud_secret_sync: bool = False
    url: str = ""
    auth_style: HttpAuthStyle | None = None
    auth_field_id: str | None = None
    command: str = ""
    args: tuple[ArgTemplate, ...] = ()
    env: tuple[EnvTemplate, ...] = ()


def _field(
    id: str,
    label: str,
    placeholder: str,
    helper_text: str,
    get_token_instructions: str,
    prefix_hint: str | None = None,
) -> CatalogField:
    return CatalogField(
        id=id,
        label=label,
        placeholder=placeholder,
        helper_text=helper_text,
        get_token_instructions=get_token_instructions,
        prefix_hint=prefix_hint,
    )


CONNECTOR_CATALOG: tuple[CatalogEntry, ...] = (
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
        auth_style=HttpAuthStyle(kind="bearer"),
        auth_field_id="personal_access_token",
        url="https://api.githubcopilot.com/mcp/",
        server_name_base="github",
        icon_id="github",
        required_fields=(
            _field(
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
        id="gmail",
        version=1,
        name="Gmail",
        one_liner="Search and read authorized Gmail messages.",
        description=(
            "Use Gmail to find relevant email threads and bring message context into a "
            "session after you authorize the connected Google account."
        ),
        docs_url=(
            "https://support.anthropic.com/en/articles/11088742-using-the-gmail-and-"
            "google-calendar-integrations"
        ),
        availability="universal",
        transport="http",
        auth_kind="oauth",
        url="https://gmail.mcp.claude.com/mcp",
        server_name_base="gmail",
        icon_id="gmail",
        required_fields=(),
        capabilities=(
            "Search authorized Gmail messages",
            "Read matching email threads",
            "Use email context when answering session questions",
        ),
    ),
    CatalogEntry(
        id="google_calendar",
        version=1,
        name="Google Calendar",
        one_liner="Search events and schedule context from Google Calendar.",
        description=(
            "Use Google Calendar to inspect authorized events, meeting details, and "
            "schedule context after you authorize the connected Google account."
        ),
        docs_url=(
            "https://support.anthropic.com/en/articles/11088742-using-the-gmail-and-"
            "google-calendar-integrations"
        ),
        availability="universal",
        transport="http",
        auth_kind="oauth",
        url="https://gcal.mcp.claude.com/mcp",
        server_name_base="google_calendar",
        icon_id="calendar",
        required_fields=(),
        capabilities=(
            "Search authorized calendar events",
            "Read meeting details and attendees",
            "Use schedule context when planning work",
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
        auth_style=HttpAuthStyle(kind="bearer"),
        auth_field_id="api_key",
        url="https://mcp.context7.com/mcp",
        server_name_base="context7",
        icon_id="context7",
        required_fields=(
            _field(
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
        auth_style=HttpAuthStyle(kind="query", parameter_name="exaApiKey"),
        auth_field_id="api_key",
        url="https://mcp.exa.ai/mcp",
        server_name_base="exa",
        icon_id="search",
        required_fields=(
            _field(
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
        id="brave_search",
        version=1,
        name="Brave Search",
        one_liner="Search the web with Brave's independent index.",
        description="Use Brave Search for current web results, news, and general lookups.",
        docs_url="https://api-dashboard.search.brave.com/documentation/guides/authentication",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        auth_style=HttpAuthStyle(kind="header", header_name="X-Subscription-Token"),
        auth_field_id="api_key",
        url="",
        server_name_base="brave_search",
        icon_id="brave",
        required_fields=(
            _field(
                "api_key",
                "API key",
                "Paste your Brave Search API key",
                "Create a key in your Brave Search API dashboard.",
                "Create a key in your Brave Search API dashboard, then paste it here.",
            ),
        ),
        capabilities=(
            "Search the open web with Brave's independent index",
            "Pull news and recent articles",
            "Look up unfamiliar terms and references",
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
        auth_style=HttpAuthStyle(kind="bearer"),
        auth_field_id="api_key",
        url="https://mcp.tavily.com/mcp",
        server_name_base="tavily",
        icon_id="tavily",
        required_fields=(
            _field(
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
        id="openweather",
        version=1,
        name="OpenWeather",
        one_liner="Fetch current weather and forecasts anywhere.",
        description="Use OpenWeather for live conditions, forecasts, and weather lookups.",
        docs_url="https://openweathermap.org/appid",
        availability="universal",
        cloud_secret_sync=True,
        transport="http",
        auth_kind="secret",
        auth_style=HttpAuthStyle(kind="query", parameter_name="appid"),
        auth_field_id="api_key",
        url="",
        server_name_base="openweather",
        icon_id="openweather",
        required_fields=(
            _field(
                "api_key",
                "API key",
                "Paste your OpenWeather API key",
                "Create an API key in your OpenWeather account.",
                "Find your OpenWeather API key on the API key tab, then paste it here.",
            ),
        ),
        capabilities=(
            "Look up current weather conditions anywhere",
            "Pull short-term forecasts",
            "Check wind, humidity, and pressure for a location",
        ),
    ),
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
        url="https://mcp.linear.app/mcp",
        server_name_base="linear",
        icon_id="linear",
        required_fields=(),
        capabilities=(
            "Search issues, projects, and cycles",
            "Inspect team workloads and states",
            "Follow up on ticket status and ownership",
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
        url="https://mcp.supabase.com/mcp",
        server_name_base="supabase",
        icon_id="supabase",
        required_fields=(),
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
        url="https://mcp.notion.com/mcp",
        server_name_base="notion",
        icon_id="notion",
        required_fields=(),
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
        required_fields=(),
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
        required_fields=(),
        capabilities=(
            "Launch a headless browser session",
            "Click, type, and navigate pages",
            "Capture DOM state and page snapshots",
        ),
    ),
)

CATALOG_BY_ID = {entry.id: entry for entry in CONNECTOR_CATALOG}


def get_catalog_entry(catalog_entry_id: str) -> CatalogEntry | None:
    return CATALOG_BY_ID.get(catalog_entry_id)


def connector_supports_target(entry: CatalogEntry, target_location: str) -> bool:
    if entry.availability == "universal":
        return target_location in {"local", "cloud"}
    if entry.availability == "local_only":
        return target_location == "local"
    return target_location == "cloud"


def build_oauth_server_url(entry: CatalogEntry, settings: dict[str, object]) -> str:
    if entry.id != "supabase":
        return entry.url
    if settings.get("kind") != "supabase":
        return entry.url
    project_ref = str(settings.get("projectRef") or "")
    read_only = "true" if settings.get("readOnly") is not False else "false"
    if not project_ref:
        return entry.url
    return f"{entry.url}?{urlencode({'project_ref': project_ref, 'read_only': read_only})}"
