import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    oneLiner: "Search repositories, issues, pull requests, and code on GitHub.",
    description:
      "Use GitHub to inspect repositories, review pull requests, follow issues, and pull in docs without leaving Proliferate.",
    docsUrl:
      "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
    availability: "universal",
    cloudSecretSync: true,
    transport: "http",
    authStyle: { kind: "bearer" },
    authFieldId: "personal_access_token",
    url: "https://api.githubcopilot.com/mcp/",
    serverNameBase: "github",
    iconId: "github",
    requiredFields: [
      {
        id: "personal_access_token",
        label: "Personal access token",
        placeholder: "github_pat_...",
        helperText: "Use a fine-grained personal access token.",
        getTokenInstructions:
          "Open GitHub Settings, create a fine-grained personal access token, copy it, and paste it here. If you need organization or private-repo access, GitHub may require extra approval.",
        prefixHint: "github_pat_",
      },
    ],
  },
  {
    id: "context7",
    name: "Context7",
    oneLiner: "Pull current library docs into every session.",
    description:
      "Use Context7 when Proliferate needs current, version-specific documentation and code examples for the libraries in your project.",
    docsUrl: "https://context7.com/docs/howto/api-keys",
    availability: "universal",
    cloudSecretSync: true,
    transport: "http",
    authStyle: { kind: "bearer" },
    authFieldId: "api_key",
    url: "https://mcp.context7.com/mcp",
    serverNameBase: "context7",
    iconId: "globe",
    requiredFields: [
      {
        id: "api_key",
        label: "API key",
        placeholder: "ctx7sk-...",
        helperText: "Create a key in your Context7 dashboard.",
        getTokenInstructions:
          "Open the Context7 dashboard, click Create API Key, give it a name like “Proliferate”, copy the key immediately, and paste it here.",
        prefixHint: "ctx7sk-",
      },
    ],
  },
  {
    id: "brave_search",
    name: "Brave Search",
    oneLiner: "Search the web with Brave's independent index.",
    description:
      "Use Brave Search for current web results, news, and general lookups without routing through a browser.",
    docsUrl:
      "https://api-dashboard.search.brave.com/documentation/guides/authentication",
    availability: "universal",
    cloudSecretSync: true,
    transport: "http",
    authStyle: { kind: "header", headerName: "X-Subscription-Token" },
    authFieldId: "api_key",
    url: "",
    serverNameBase: "brave_search",
    iconId: "search",
    requiredFields: [
      {
        id: "api_key",
        label: "API key",
        placeholder: "Paste your Brave Search API key",
        helperText: "Create a key in your Brave Search API dashboard.",
        getTokenInstructions:
          "Choose a Brave Search API plan, open the API Keys section in your dashboard, create a key, then paste it here.",
      },
    ],
  },
  {
    id: "tavily",
    name: "Tavily",
    oneLiner: "Search, extract, and research the web.",
    description:
      "Use Tavily when Proliferate needs web search plus extraction and crawl tools for deeper research tasks.",
    docsUrl: "https://docs.tavily.com/guides/quickstart",
    availability: "universal",
    cloudSecretSync: true,
    transport: "http",
    authStyle: { kind: "bearer" },
    authFieldId: "api_key",
    url: "https://mcp.tavily.com/mcp",
    serverNameBase: "tavily",
    iconId: "globe",
    requiredFields: [
      {
        id: "api_key",
        label: "API key",
        placeholder: "tvly-...",
        helperText: "Get a free key from Tavily.",
        getTokenInstructions:
          "Open the Tavily dashboard, copy one of your API keys, and paste it here.",
        prefixHint: "tvly-",
      },
    ],
  },
  {
    id: "openweather",
    name: "OpenWeather",
    oneLiner: "Fetch current weather and forecasts anywhere.",
    description:
      "Use OpenWeather for live conditions, short-term forecasts, and weather lookups without leaving the session.",
    docsUrl: "https://openweathermap.org/appid",
    availability: "universal",
    cloudSecretSync: true,
    transport: "http",
    authStyle: { kind: "query", parameterName: "appid" },
    authFieldId: "api_key",
    url: "",
    serverNameBase: "openweather",
    iconId: "sun",
    requiredFields: [
      {
        id: "api_key",
        label: "API key",
        placeholder: "Paste your OpenWeather API key",
        helperText: "Create an API key in your OpenWeather account.",
        getTokenInstructions:
          "Sign up for OpenWeather, find your API key on the API key tab of your account page, then paste it here.",
      },
    ],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    oneLiner: "Read and write files inside the current workspace.",
    description:
      "Use the Filesystem server when Proliferate should inspect or edit files directly through MCP against the active workspace path.",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    availability: "local_only",
    cloudSecretSync: false,
    transport: "stdio",
    command: "mcp-server-filesystem",
    args: [{ source: { kind: "workspace_path" } }],
    env: [],
    serverNameBase: "filesystem",
    iconId: "folder",
    requiredFields: [],
  },
  {
    id: "playwright",
    name: "Playwright",
    oneLiner: "Drive and inspect the browser with Playwright tools.",
    description:
      "Use Playwright when Proliferate needs browser automation, DOM inspection, and page interaction over MCP.",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
    availability: "local_only",
    cloudSecretSync: false,
    transport: "stdio",
    command: "playwright-mcp",
    args: [],
    env: [],
    serverNameBase: "playwright",
    iconId: "terminal",
    requiredFields: [],
  },
] as const;
