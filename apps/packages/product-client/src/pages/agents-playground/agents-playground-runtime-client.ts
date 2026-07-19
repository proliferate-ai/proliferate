import type { AgentSummary, ReconcileAgentsResponse } from "@anyharness/sdk";

export interface AgentsPlaygroundRuntimeRequest {
  method: string;
  path: string;
  runtimeUrl: string;
}

export interface AgentsPlaygroundRuntimeTransport {
  fetch: typeof globalThis.fetch;
  requests: AgentsPlaygroundRuntimeRequest[];
  snapshot(): {
    agent: AgentSummary;
    reconcile: ReconcileAgentsResponse;
  };
}

export function createAgentsPlaygroundRuntimeTransport({
  runtimeUrls,
  agent: initialAgent,
  reconcile: initialReconcile,
}: {
  runtimeUrls: string[];
  agent: AgentSummary;
  reconcile: ReconcileAgentsResponse;
}): AgentsPlaygroundRuntimeTransport {
  const bases = runtimeUrls.map((runtimeUrl) => normalizeBase(runtimeUrl));
  const requests: AgentsPlaygroundRuntimeRequest[] = [];
  let agent = clone(initialAgent);
  let reconcile = clone(initialReconcile);

  const fixtureFetch: typeof globalThis.fetch = async (input, init) => {
    const requestUrl = resolveRequestUrl(input);
    const runtimeBase = bases.find((base) => requestUrl.href.startsWith(`${base}/`));
    if (!runtimeBase) {
      throw new Error(`Agents playground runtime forbids network access: ${requestUrl.href}`);
    }

    const method = resolveRequestMethod(input, init);
    const path = requestUrl.href.slice(runtimeBase.length);
    requests.push({ method, path, runtimeUrl: runtimeBase });

    if (method === "GET" && path === "/health") {
      return jsonResponse({
        status: "ok",
        version: "playground",
        runtimeHome: "/agents-playground",
        executionStoreId: "agents-playground",
        capabilities: {},
        agentSeed: { status: "ready" },
        agentReconcile: { status: reconcile.status },
      });
    }
    if (method === "GET" && path === "/v1/agents") {
      return jsonResponse([agent]);
    }
    if (method === "GET" && path === "/v1/agents/reconcile") {
      return jsonResponse(reconcile);
    }
    if (method === "POST" && path === "/v1/agents/reconcile") {
      reconcile = runningReconcile(agent.kind);
      agent = { ...agent, installState: "installing" };
      return jsonResponse(reconcile);
    }

    const installMatch = path.match(/^\/v1\/agents\/([^/]+)\/install$/);
    if (method === "POST" && installMatch) {
      const kind = decodeURIComponent(installMatch[1] ?? "");
      if (kind !== agent.kind) {
        return jsonResponse({ detail: `Unknown playground agent: ${kind}` }, 404);
      }
      reconcile = runningReconcile(agent.kind);
      agent = { ...agent, installState: "installing" };
      return jsonResponse({
        agent,
        alreadyInstalled: false,
        installedArtifacts: [],
      });
    }

    if (method === "GET" && path === "/v1/agents/launch-options") {
      return jsonResponse({ agents: [launchOptions(agent)] });
    }

    const gatewayModelsMatch = path.match(
      /^\/v1\/agents\/([^/]+)\/catalog\/gateway-models$/,
    );
    if (gatewayModelsMatch && method === "GET") {
      return jsonResponse(gatewayModels());
    }
    if (gatewayModelsMatch && method === "POST") {
      return jsonResponse({
        models: ["model-default", "model-fast"],
        probedAt: "2026-07-18T18:00:00Z",
      });
    }

    throw new Error(
      `Unhandled Agents playground runtime request: ${method} ${path}`,
    );
  };

  return {
    fetch: fixtureFetch,
    requests,
    snapshot: () => ({
      agent: clone(agent),
      reconcile: clone(reconcile),
    }),
  };
}

function runningReconcile(kind: string): ReconcileAgentsResponse {
  return {
    jobId: "playground-install",
    status: "running",
    reinstall: true,
    installedOnly: false,
    results: [],
    startedAt: "2026-07-18T18:00:00Z",
    progress: {
      completedComponents: 0,
      totalComponents: 2,
      downloadedBytes: 12_000_000,
      downloadSizeBytes: 100_000_000,
      components: [
        {
          agent: kind,
          role: "native_cli",
          phase: "downloading",
          downloadedBytes: 12_000_000,
          downloadSizeBytes: 100_000_000,
        },
        {
          agent: kind,
          role: "agent_process",
          phase: "queued",
          downloadedBytes: 0,
          downloadSizeBytes: null,
        },
      ],
    },
  };
}

function launchOptions(agent: AgentSummary) {
  return {
    kind: agent.kind,
    displayName: agent.displayName,
    defaultModelId: "model-default",
    models: [
      { id: "model-default", displayName: "Recommended", provider: "provider", isDefault: true },
      { id: "model-fast", displayName: "Fast", provider: "provider", isDefault: false },
    ],
  };
}

function gatewayModels() {
  return {
    source: "probe",
    probedAt: "2026-07-18T18:00:00Z",
    models: [
      { id: "model-default", displayName: "Recommended", provider: "provider" },
      { id: "model-fast", displayName: "Fast", provider: "provider" },
    ],
  };
}

function resolveRequestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function resolveRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  return input instanceof Request ? input.method.toUpperCase() : "GET";
}

function normalizeBase(runtimeUrl: string): string {
  return new URL(runtimeUrl).href.replace(/\/+$/, "");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
