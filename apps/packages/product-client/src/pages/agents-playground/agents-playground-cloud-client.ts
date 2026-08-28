import type {
  AgentApiKey,
  AgentAuthSelection,
  AgentAuthSurface,
  AgentModelOverride,
  AgentModels,
  CreateAgentApiKeyRequest,
  ProliferateCloudClient,
  ProliferateRequestJsonInput,
  PutAuthSelectionsRequest,
  UpsertAgentModelOverrideRequest,
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
  agentModels: AgentModels[];
  overrides: AgentModelOverride[];
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
// The composed re-key (model-catalog.md §Cloud routes): one layered document
// per harness, keyed by (owner, harness). The former per-authContextId
// seeding (one document per catalog auth-context id) is deleted with the
// context-free route.

export function createAgentsPlaygroundCloudTransport(
  seed: AgentsPlaygroundCloudSeed,
): AgentsPlaygroundCloudTransport {
  let keySequence = seed.apiKeys.length;
  let selectionSequence = seed.selections.length;
  let overrideSequence = 0;
  const apiKeys = seed.apiKeys.map((key) => ({ ...key }));
  let selections = seed.selections.map((selection) => ({ ...selection }));
  const agentModels = new Map<string, AgentModels>();
  const overrides = new Map<string, AgentModelOverride>();
  const requests: AgentsPlaygroundCloudRequest[] = [];

  agentModels.set(seed.harnessKind, makeAgentModels(seed.harnessKind));

  async function requestJson<TResponse>(input: ProliferateRequestJsonInput): Promise<TResponse> {
    requests.push({
      method: input.method,
      path: input.path,
      query: input.query ? { ...input.query } : undefined,
      body: input.body,
    });

    if (input.path === "/v1/cloud/agent-auth/keys") {
      if (input.method === "GET") return clone(apiKeys) as TResponse;
      if (input.method === "POST") {
        const body = input.body as CreateAgentApiKeyRequest;
        keySequence += 1;
        const key: AgentApiKey = {
          id: `playground-key-${keySequence}`,
          title: body.title ?? "API key",
          kind: "api_key",
          redactedHint: redactSecret(body.value),
          seatEmail: null,
          seatPlan: null,
          status: "active",
          createdAt: FIXTURE_TIME,
        };
        apiKeys.push(key);
        return clone(key) as TResponse;
      }
    }

    const apiKeyMatch = input.path.match(
      /^\/v1\/cloud\/agent-auth\/keys\/([^/]+)$/,
    );
    if (input.method === "DELETE" && apiKeyMatch) {
      const keyId = decodeURIComponent(apiKeyMatch[1] ?? "");
      const index = apiKeys.findIndex((key) => key.id === keyId);
      if (index < 0) throw new Error(`Unknown playground API key: ${keyId}`);
      const [revoked] = apiKeys.splice(index, 1);
      return { ...revoked, status: "revoked" } as TResponse;
    }

    if (input.path === "/v1/cloud/agent-auth/selections" && input.method === "GET") {
      const surface = input.query?.surface as AgentAuthSurface | undefined;
      const rows = surface
        ? selections.filter((selection) => selection.surface === surface)
        : selections;
      return clone(rows) as TResponse;
    }

    const selectionMatch = input.path.match(
      /^\/v1\/cloud\/agent-auth\/selections\/([^/]+)$/,
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

    if (input.path === "/v1/cloud/agent-auth/state" && input.method === "GET") {
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

    // The composed cloud snapshot re-key (model-catalog.md §Cloud routes):
    // layered read + override, keyed by harness alone — no authContextId
    // query. There is no playground-callable refresh here — the real ingest
    // route is Worker-authenticated only (F-040), so a product client (this
    // fixture's subject) never calls it either.
    const agentModelsMatch = input.path.match(
      /^\/v1\/cloud\/agent-models\/([^/]+)(\/override)?$/,
    );
    if (agentModelsMatch) {
      const harnessKind = decodeURIComponent(agentModelsMatch[1] ?? "");
      const action = agentModelsMatch[2] ?? "";
      if (input.method === "GET" && action === "") {
        return clone(requiredAgentModels(agentModels, harnessKind)) as TResponse;
      }
      if (input.method === "PUT" && action === "/override") {
        const body = input.body as UpsertAgentModelOverrideRequest;
        overrideSequence += 1;
        const override: AgentModelOverride = {
          id: `playground-override-${overrideSequence}`,
          harnessKind,
          patchJson: body.patchJson,
          createdAt: FIXTURE_TIME,
          updatedAt: FIXTURE_TIME,
        };
        overrides.set(harnessKind, override);
        for (const [key, entry] of agentModels) {
          if (entry.harnessKind === harnessKind) {
            agentModels.set(key, { ...entry, overrideApplied: true });
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
      agentModels: clone([...agentModels.values()]),
      overrides: clone([...overrides.values()]),
    }),
  };
}

function makeAgentModels(harnessKind: string): AgentModels {
  return {
    harnessKind,
    models: [
      { id: "model-default", displayName: "Recommended", provider: "provider", enabled: true },
      { id: "model-fast", displayName: "Fast", provider: "provider", enabled: true },
    ],
    modes: [{ id: "build" }],
    origin: "snapshot",
    snapshotId: "playground-snapshot",
    probedAt: FIXTURE_TIME,
    overrideApplied: false,
  };
}

function requiredAgentModels(
  agentModels: Map<string, AgentModels>,
  harnessKind: string,
) {
  const entry = agentModels.get(harnessKind);
  if (!entry) throw new Error(`Unknown playground agent models: ${harnessKind}`);
  return entry;
}

function redactSecret(value: string) {
  const suffix = value.slice(-3);
  return value.length > 6 ? `${value.slice(0, 3)}-...${suffix}` : "••••••";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
