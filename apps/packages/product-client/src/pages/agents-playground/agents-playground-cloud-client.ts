import type {
  AgentApiKey,
  AgentAuthSelection,
  AgentAuthSurface,
  AgentGatewayCatalog,
  AgentGatewayCatalogOverride,
  CreateAgentApiKeyRequest,
  ProliferateCloudClient,
  ProliferateRequestJsonInput,
  PutAuthSelectionsRequest,
  RefreshAgentGatewayCatalogRequest,
  UpsertAgentGatewayCatalogOverrideRequest,
} from "@proliferate/cloud-sdk";
import type { ProductHost } from "@proliferate/product-client/host/product-host";

export const PLAYGROUND_CLOUD_URL = "http://agents-playground.cloud";

export interface AgentsPlaygroundCloudSeed {
  harnessKind: "claude" | "opencode";
  apiKeys: AgentApiKey[];
  selections: AgentAuthSelection[];
}

export interface AgentsPlaygroundCloudRequest {
  method: ProliferateRequestJsonInput["method"];
  path: string;
  query?: ProliferateRequestJsonInput["query"];
  body?: unknown;
}

export interface AgentsPlaygroundCloudSnapshot {
  apiKeys: AgentApiKey[];
  selections: AgentAuthSelection[];
  catalogs: AgentGatewayCatalog[];
  overrides: AgentGatewayCatalogOverride[];
}

export interface AgentsPlaygroundCloudTransport {
  client: ProliferateCloudClient;
  requests: AgentsPlaygroundCloudRequest[];
  snapshot(): AgentsPlaygroundCloudSnapshot;
}

export function buildPlaygroundHost(
  parentHost: ProductHost,
  authenticated: boolean,
  cloudClient: ProliferateCloudClient,
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
    cloud: {
      client: cloudClient,
      getSandboxGatewayAccessToken: () => Promise.resolve("agents-playground-token"),
    },
  };
}

const FIXTURE_TIME = "2026-07-18T18:00:00Z";
const ROUTES = ["native", "api_key", "gateway"] as const;
const SURFACES = ["local", "cloud"] as const;

export function createAgentsPlaygroundCloudTransport(
  seed: AgentsPlaygroundCloudSeed,
): AgentsPlaygroundCloudTransport {
  let keySequence = seed.apiKeys.length;
  let selectionSequence = seed.selections.length;
  let overrideSequence = 0;
  const apiKeys = seed.apiKeys.map((key) => ({ ...key }));
  let selections = seed.selections.map((selection) => ({ ...selection }));
  const catalogs = new Map<string, AgentGatewayCatalog>();
  const overrides = new Map<string, AgentGatewayCatalogOverride>();
  const requests: AgentsPlaygroundCloudRequest[] = [];

  for (const surface of SURFACES) {
    for (const route of ROUTES) {
      const catalog = makeCatalog(seed.harnessKind, surface, route);
      catalogs.set(catalogKey(seed.harnessKind, surface, route), catalog);
    }
  }

  async function requestJson<TResponse>(input: ProliferateRequestJsonInput): Promise<TResponse> {
    requests.push({
      method: input.method,
      path: input.path,
      query: input.query ? { ...input.query } : undefined,
      body: input.body,
    });

    if (input.path === "/v1/cloud/agent-gateway/keys") {
      if (input.method === "GET") return clone(apiKeys) as TResponse;
      if (input.method === "POST") {
        const body = input.body as CreateAgentApiKeyRequest;
        keySequence += 1;
        const key: AgentApiKey = {
          id: `playground-key-${keySequence}`,
          title: body.title,
          redactedHint: redactSecret(body.value),
          status: "active",
          createdAt: FIXTURE_TIME,
        };
        apiKeys.push(key);
        return clone(key) as TResponse;
      }
    }

    const apiKeyMatch = input.path.match(
      /^\/v1\/cloud\/agent-gateway\/keys\/([^/]+)$/,
    );
    if (input.method === "DELETE" && apiKeyMatch) {
      const keyId = decodeURIComponent(apiKeyMatch[1] ?? "");
      const index = apiKeys.findIndex((key) => key.id === keyId);
      if (index < 0) throw new Error(`Unknown playground API key: ${keyId}`);
      const [revoked] = apiKeys.splice(index, 1);
      return { ...revoked, status: "revoked" } as TResponse;
    }

    if (input.path === "/v1/cloud/agent-gateway/selections" && input.method === "GET") {
      const surface = input.query?.surface as AgentAuthSurface | undefined;
      const rows = surface
        ? selections.filter((selection) => selection.surface === surface)
        : selections;
      return clone(rows) as TResponse;
    }

    const selectionMatch = input.path.match(
      /^\/v1\/cloud\/agent-gateway\/selections\/([^/]+)$/,
    );
    if (input.method === "PUT" && selectionMatch) {
      const harnessKind = decodeURIComponent(selectionMatch[1] ?? "");
      const surface = input.query?.surface as AgentAuthSurface;
      const body = input.body as PutAuthSelectionsRequest;
      selections = selections.filter(
        (selection) => selection.harnessKind !== harnessKind || selection.surface !== surface,
      );
      const replacements = body.sources.map((source) => {
        selectionSequence += 1;
        const key = apiKeys.find((candidate) => candidate.id === source.apiKeyId);
        return {
          id: `playground-selection-${selectionSequence}`,
          harnessKind,
          surface,
          sourceKind: source.sourceKind,
          apiKeyId: source.apiKeyId ?? null,
          keyTitle: key?.title ?? null,
          envVarName: source.envVarName ?? null,
          providerHint: source.providerHint ?? null,
          enabled: source.enabled,
          createdAt: FIXTURE_TIME,
          updatedAt: FIXTURE_TIME,
        } satisfies AgentAuthSelection;
      });
      selections.push(...replacements);
      return clone(replacements) as TResponse;
    }

    if (input.path === "/v1/cloud/agent-gateway/state" && input.method === "GET") {
      return {
        version: 2,
        revision: 1,
        user_id: "agents-playground",
        harnesses: [],
      } as TResponse;
    }

    if (input.path === "/v1/cloud/agent-gateway/capabilities" && input.method === "GET") {
      return {
        gatewayEnabled: true,
        publicBaseUrl: "https://gateway.proliferate.dev",
        enrollmentStatus: "synced",
      } as TResponse;
    }

    if (input.path === "/v1/cloud/agent-gateway/enrollment" && input.method === "GET") {
      return {
        id: "playground-enrollment",
        subjectKind: "user",
        litellmTeamId: "playground-team",
        syncStatus: "synced",
        lastErrorCode: null,
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
      } as TResponse;
    }

    const catalogMatch = input.path.match(
      /^\/v1\/cloud\/agent-gateway\/catalog\/([^/]+)(\/refresh|\/override)?$/,
    );
    if (catalogMatch) {
      const harnessKind = decodeURIComponent(catalogMatch[1] ?? "");
      const action = catalogMatch[2] ?? "";
      if (input.method === "GET" && action === "") {
        const surface = input.query?.surface as AgentAuthSurface;
        const route = (input.query?.route ?? "gateway") as AgentGatewayCatalog["route"];
        return clone(requiredCatalog(catalogs, harnessKind, surface, route)) as TResponse;
      }
      if (input.method === "POST" && action === "/refresh") {
        const body = input.body as RefreshAgentGatewayCatalogRequest;
        const current = requiredCatalog(catalogs, harnessKind, body.surface, body.route);
        const refreshed = {
          ...current,
          models: parseModels(body.modelsJson) ?? current.models,
          snapshotId: "playground-refreshed-snapshot",
          probedAt: FIXTURE_TIME,
          source: "probe",
        };
        catalogs.set(catalogKey(harnessKind, body.surface, body.route), refreshed);
        return clone(refreshed) as TResponse;
      }
      if (input.method === "PUT" && action === "/override") {
        const body = input.body as UpsertAgentGatewayCatalogOverrideRequest;
        overrideSequence += 1;
        const override: AgentGatewayCatalogOverride = {
          id: `playground-override-${overrideSequence}`,
          harnessKind,
          patchJson: body.patchJson,
          createdAt: FIXTURE_TIME,
          updatedAt: FIXTURE_TIME,
        };
        overrides.set(harnessKind, override);
        for (const [key, catalog] of catalogs) {
          if (catalog.harnessKind === harnessKind) {
            catalogs.set(key, { ...catalog, overrideApplied: true });
          }
        }
        return clone(override) as TResponse;
      }
    }

    throw new Error(
      `Unhandled Agents playground Cloud request: ${input.method} ${input.path}`,
    );
  }

  const rejectNetwork = () => Promise.reject(
    new Error("Agents playground Cloud transport forbids network access."),
  );
  const client = {
    baseUrl: PLAYGROUND_CLOUD_URL,
    requestJson,
    requestForm: rejectNetwork,
    streamRequest: rejectNetwork,
    buildUrl: (path: string) => `${PLAYGROUND_CLOUD_URL}${path}`,
    GET: rejectNetwork,
    POST: rejectNetwork,
    PUT: rejectNetwork,
    PATCH: rejectNetwork,
    DELETE: rejectNetwork,
  } as unknown as ProliferateCloudClient;

  return {
    client,
    requests,
    snapshot: () => ({
      apiKeys: clone(apiKeys),
      selections: clone(selections),
      catalogs: clone([...catalogs.values()]),
      overrides: clone([...overrides.values()]),
    }),
  };
}

function makeCatalog(
  harnessKind: string,
  surface: AgentAuthSurface,
  route: AgentGatewayCatalog["route"],
): AgentGatewayCatalog {
  return {
    harnessKind,
    surface,
    route,
    models: [
      { id: "model-default", displayName: "Recommended", provider: "provider", enabled: true },
      { id: "model-fast", displayName: "Fast", provider: "provider", enabled: true },
    ],
    snapshotId: "playground-snapshot",
    probedAt: FIXTURE_TIME,
    source: "probe",
    overrideApplied: false,
  };
}

function catalogKey(
  harnessKind: string,
  surface: AgentAuthSurface,
  route: AgentGatewayCatalog["route"],
) {
  return `${harnessKind}:${surface}:${route}`;
}

function requiredCatalog(
  catalogs: Map<string, AgentGatewayCatalog>,
  harnessKind: string,
  surface: AgentAuthSurface,
  route: AgentGatewayCatalog["route"],
) {
  const catalog = catalogs.get(catalogKey(harnessKind, surface, route));
  if (!catalog) throw new Error(`Unknown playground catalog: ${harnessKind}/${surface}/${route}`);
  return catalog;
}

function parseModels(modelsJson: string | null | undefined): Record<string, unknown>[] | null {
  if (!modelsJson) return null;
  const parsed = JSON.parse(modelsJson) as unknown;
  return Array.isArray(parsed) ? parsed as Record<string, unknown>[] : null;
}

function redactSecret(value: string) {
  const suffix = value.slice(-3);
  return value.length > 6 ? `${value.slice(0, 3)}-...${suffix}` : "••••••";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
