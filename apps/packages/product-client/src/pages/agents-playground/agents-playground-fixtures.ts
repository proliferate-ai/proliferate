import type { AgentSummary, ReconcileAgentsResponse } from "@anyharness/sdk";
import {
  anyHarnessAgentGatewayModelsKey,
  anyHarnessAgentLaunchOptionsKey,
  anyHarnessAgentReconcileStatusKey,
  anyHarnessAgentsKey,
} from "@anyharness/sdk-react";
import type { AgentApiKey, AgentAuthSelection } from "@proliferate/cloud-sdk";
import {
  agentApiKeysKey,
  agentAuthSelectionsKey,
  agentAuthStateKey,
  agentGatewayCapabilitiesKey,
  agentGatewayCatalogKey,
  agentGatewayEnrollmentKey,
  controlPlaneHealthKey,
} from "@proliferate/cloud-sdk-react/lib/query-keys";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { QueryClient } from "@tanstack/react-query";
import { serverCapabilitiesKey } from "#product/hooks/access/cloud/server-capabilities/query-keys";

export const PLAYGROUND_RUNTIME_URL = "http://agents-playground.runtime";
export const PLAYGROUND_CACHE_SCOPE = "agents-playground";
export type AgentsPlaygroundScenarioId =
  | "ready-local"
  | "login-required"
  | "install-required"
  | "updating"
  | "runtime-error"
  | "opencode-multi-source"
  | "cloud-signed-out"
  | "cloud-ready"
  | "api-keys-empty"
  | "api-keys-ready"
  | "api-keys-loading"
  | "api-keys-error";

export interface AgentsPlaygroundScenario {
  id: AgentsPlaygroundScenarioId;
  label: string;
  harnessKind: "claude" | "opencode";
  pane: "harness" | "api-keys";
  surface: "cloud" | "local";
}

export const SCENARIOS: readonly AgentsPlaygroundScenario[] = [
  { id: "ready-local", label: "Ready", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "login-required", label: "Login required", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "install-required", label: "Install required", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "updating", label: "Updating", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "runtime-error", label: "Runtime error", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "opencode-multi-source", label: "Multiple auth", harnessKind: "opencode", pane: "harness", surface: "local" },
  { id: "cloud-signed-out", label: "Cloud signed out", harnessKind: "claude", pane: "harness", surface: "cloud" },
  { id: "cloud-ready", label: "Cloud ready", harnessKind: "claude", pane: "harness", surface: "cloud" },
  { id: "api-keys-empty", label: "Keys empty", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
  { id: "api-keys-ready", label: "Keys ready", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
  { id: "api-keys-loading", label: "Keys loading", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
  { id: "api-keys-error", label: "Keys error", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
];

interface FixtureState {
  authenticated: boolean;
  agent: AgentSummary;
  reconcile: ReconcileAgentsResponse;
  selections: AgentAuthSelection[];
  apiKeys: AgentApiKey[];
}

function buildAgent(
  kind: "claude" | "opencode",
  readiness: AgentSummary["readiness"],
): AgentSummary {
  const displayName = kind === "claude" ? "Claude Code" : "OpenCode";
  const installed = readiness !== "install_required";
  const installState = readiness === "install_required"
    ? "install_required"
    : readiness === "error"
      ? "failed"
      : "installed";
  return {
    kind,
    displayName,
    readiness,
    supportsLogin: kind === "claude",
    cliAuthState: kind === "claude"
      ? readiness === "login_required"
        ? "expired"
        : readiness === "ready"
          ? "authenticated"
          : "absent"
      : "unsupported",
    credentialState: readiness === "ready"
      ? "ready"
      : readiness === "login_required"
        ? "login_required"
        : "unknown",
    installState,
    nativeRequired: true,
    native: {
      installed,
      role: "native_cli",
      version: installed ? "1.0.0" : null,
    },
    agentProcess: {
      installed,
      role: "agent_process",
      version: installed ? "1.0.0" : null,
    },
    expectedEnvVars: kind === "claude" ? ["ANTHROPIC_API_KEY"] : [],
    message: readiness === "error"
      ? "The runtime could not verify this harness installation."
      : null,
  };
}

function buildSelection(
  id: string,
  harnessKind: "claude" | "opencode",
  surface: "cloud" | "local",
  sourceKind: "api_key" | "gateway",
  apiKeyId: string | null = null,
): AgentAuthSelection {
  return {
    id,
    harnessKind,
    surface,
    sourceKind,
    apiKeyId,
    keyTitle: apiKeyId ? "OpenRouter production" : null,
    envVarName: apiKeyId ? "OPENROUTER_API_KEY" : null,
    providerHint: apiKeyId ? "openrouter" : null,
    enabled: true,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function buildFixtureState(scenario: AgentsPlaygroundScenario): FixtureState {
  const readiness: AgentSummary["readiness"] = scenario.id === "login-required"
    ? "login_required"
    : scenario.id === "install-required"
      ? "install_required"
      : scenario.id === "runtime-error"
        ? "error"
        : "ready";
  const hasKeys = scenario.id === "api-keys-ready"
    || scenario.id === "opencode-multi-source";
  const apiKeys: AgentApiKey[] = hasKeys
    ? [
        {
          id: "key-1",
          title: "OpenRouter production",
          redactedHint: "sk-or-...9f2",
          status: "active",
          createdAt: "2026-07-01T00:00:00Z",
        },
        {
          id: "key-2",
          title: "Anthropic personal",
          redactedHint: "sk-ant-...3e1",
          status: "active",
          createdAt: "2026-06-15T00:00:00Z",
        },
      ]
    : [];
  const selections = scenario.id === "opencode-multi-source"
    ? [
        buildSelection("selection-gateway", "opencode", "local", "gateway"),
        buildSelection("selection-key", "opencode", "local", "api_key", "key-1"),
      ]
    : scenario.id === "cloud-ready"
      ? [buildSelection("selection-cloud", "claude", "cloud", "gateway")]
      : [];
  return {
    authenticated: scenario.id !== "cloud-signed-out",
    agent: buildAgent(scenario.harnessKind, readiness),
    reconcile: scenario.id === "updating"
      ? {
          jobId: "playground-update",
          status: "running",
          reinstall: true,
          results: [],
          startedAt: "2026-07-18T18:00:00Z",
          progress: {
            completedComponents: 0,
            totalComponents: 2,
            downloadedBytes: 42_000_000,
            downloadSizeBytes: 100_000_000,
            components: [
              {
                agent: scenario.harnessKind,
                role: "native_cli",
                phase: "downloading",
                downloadedBytes: 42_000_000,
                downloadSizeBytes: 100_000_000,
              },
              {
                agent: scenario.harnessKind,
                role: "agent_process",
                phase: "queued",
                downloadedBytes: 0,
                downloadSizeBytes: null,
              },
            ],
          },
        }
      : { status: "idle", reinstall: false, results: [] },
    selections,
    apiKeys,
  };
}

export function buildPlaygroundHost(
  parentHost: ProductHost,
  authenticated: boolean,
): ProductHost {
  return {
    ...parentHost,
    auth: {
      ...parentHost.auth,
      state: authenticated
        ? {
            status: "authenticated",
            user: { id: "agents-playground", displayName: "Agents Playground" },
            readiness: { status: "ready" },
          }
        : { status: "anonymous", methods: ["password"] },
    },
  };
}

function seedHarnessQueries(
  client: QueryClient,
  scenario: AgentsPlaygroundScenario,
  fixture: FixtureState,
) {
  client.setQueryData(
    anyHarnessAgentsKey(PLAYGROUND_RUNTIME_URL, PLAYGROUND_CACHE_SCOPE),
    [fixture.agent],
  );
  client.setQueryData(
    anyHarnessAgentReconcileStatusKey(PLAYGROUND_RUNTIME_URL, PLAYGROUND_CACHE_SCOPE),
    fixture.reconcile,
  );
  client.setQueryData(
    anyHarnessAgentLaunchOptionsKey(PLAYGROUND_RUNTIME_URL, null, PLAYGROUND_CACHE_SCOPE),
    {
      agents: [{
        kind: scenario.harnessKind,
        displayName: fixture.agent.displayName,
        defaultModelId: "model-default",
        models: [
          { id: "model-default", displayName: "Recommended", provider: "provider", isDefault: true },
          { id: "model-fast", displayName: "Fast", provider: "provider", isDefault: false },
        ],
      }],
    },
  );
  client.setQueryData(
    anyHarnessAgentGatewayModelsKey(
      PLAYGROUND_RUNTIME_URL,
      scenario.harnessKind,
      PLAYGROUND_CACHE_SCOPE,
    ),
    {
      source: "probe",
      probedAt: "2026-07-18T18:00:00Z",
      models: [
        { id: "model-default", displayName: "Recommended", provider: "provider" },
        { id: "model-fast", displayName: "Fast", provider: "provider" },
      ],
    },
  );
}

function seedCloudQueries(
  client: QueryClient,
  parentHost: ProductHost,
  scenario: AgentsPlaygroundScenario,
  fixture: FixtureState,
) {
  const apiBaseUrl = parentHost.deployment.apiBaseUrl;
  client.setQueryData(controlPlaneHealthKey(apiBaseUrl), true);
  client.setQueryData(serverCapabilitiesKey(apiBaseUrl), {
    contractVersion: 2,
    deployment: { mode: "hosted_product", displayName: "", logoUrl: null },
    billing: true,
    usageMetering: true,
    cloudWorkspaces: true,
    agentGateway: true,
    webApp: { available: true, baseUrl: null },
    support: { kind: "vendor", email: "support@proliferate.com", url: null },
    pricing: { available: true, url: "https://proliferate.com/pricing" },
    githubRepositoryAccess: {
      status: "ready",
      provider: "github_app",
      displayName: null,
    },
    managedCloud: {
      status: "ready",
      repositoryAuthority: "github_app",
      source: "v2",
    },
    workflowManagedRuns: false,
  });
  client.setQueryData(agentGatewayCapabilitiesKey(), {
    gatewayEnabled: true,
    publicBaseUrl: "https://gateway.proliferate.dev",
    enrollmentStatus: "synced",
  });
  client.setQueryData(agentGatewayEnrollmentKey(), {
    id: "playground-enrollment",
    subjectKind: "user",
    litellmTeamId: "playground-team",
    syncStatus: "synced",
    lastErrorCode: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  });
  client.setQueryData(agentAuthSelectionsKey(), fixture.selections);
  client.setQueryData(
    agentAuthSelectionsKey("local"),
    fixture.selections.filter((row) => row.surface === "local"),
  );
  client.setQueryData(
    agentAuthSelectionsKey("cloud"),
    fixture.selections.filter((row) => row.surface === "cloud"),
  );
  client.setQueryData(agentAuthStateKey("local"), {
    version: 2,
    revision: 1,
    user_id: "agents-playground",
    harnesses: [],
  });
  client.setQueryData(agentAuthStateKey("cloud"), {
    version: 2,
    revision: 1,
    user_id: "agents-playground",
    harnesses: [],
  });
  for (const surface of ["local", "cloud"] as const) {
    for (const route of ["native", "api_key", "gateway"] as const) {
      client.setQueryData(
        agentGatewayCatalogKey(scenario.harnessKind, surface, route),
        {
          harnessKind: scenario.harnessKind,
          surface,
          route,
          models: [
            { id: "model-default", displayName: "Recommended", provider: "provider", enabled: true },
            { id: "model-fast", displayName: "Fast", provider: "provider", enabled: true },
          ],
          snapshotId: "playground-snapshot",
          probedAt: "2026-07-18T18:00:00Z",
          source: "probe",
          overrideApplied: false,
        },
      );
    }
  }

  if (scenario.id === "api-keys-loading") {
    void client.prefetchQuery({
      queryKey: agentApiKeysKey(),
      queryFn: () => new Promise<AgentApiKey[]>(() => undefined),
    });
  } else if (scenario.id === "api-keys-error") {
    void client.prefetchQuery({
      queryKey: agentApiKeysKey(),
      queryFn: () => Promise.reject(new Error("Playground key-vault request failed.")),
    });
  } else {
    client.setQueryData(agentApiKeysKey(), fixture.apiKeys);
  }
}

export function buildMockQueryClient(
  parentHost: ProductHost,
  scenario: AgentsPlaygroundScenario,
): { client: QueryClient; fixture: FixtureState } {
  const fixture = buildFixtureState(scenario);
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
  seedHarnessQueries(client, scenario, fixture);
  seedCloudQueries(client, parentHost, scenario, fixture);
  return { client, fixture };
}
