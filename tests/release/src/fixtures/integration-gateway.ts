/**
 * Integration-gateway fixture for T3-INT-1's harness-use half
 * (specs/developing/testing/scenarios.md#T3-INT-1).
 *
 * The audit row PR #1101 added (`cloud_integration_tool_call_event`) is written
 * server-side by `call_provider_tool`
 * (server/proliferate/server/cloud/integration_gateway/service.py) whenever a
 * runtime worker proxies `integrations.call_tool` through the gateway. For an
 * agent session to reach that path, the worker must have written the
 * `integration-gateway.json` dotfile into the runtime home — the session-launch
 * extension only injects the `proliferate_integrations` MCP server when that
 * dotfile is present
 * (anyharness/.../sessions/mcp_bindings/integration_gateway.rs).
 *
 * The CI local lane boots `anyharness serve` with no worker plane, so nothing
 * writes that dotfile on its own. This fixture provisions it exactly the way
 * the desktop app does — mint a desktop enrollment, enroll a worker, take the
 * gateway grant's bearer from the enroll response — then writes the dotfile so
 * the running runtime injects the gateway on the next session launch. No
 * product change, no faked credential: the real enrollment endpoints mint the
 * real grant.
 */

import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ApiClient } from "./http.js";

export const GATEWAY_DOTFILE_NAME = "integration-gateway.json";

/** JSON-RPC message shape the gateway MCP endpoint speaks. */
interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
    tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    providers?: Array<{ provider: string; status: string; authKind: string }>;
  };
  error?: { code: number; message: string };
}

export interface GatewayGrant {
  workerId: string;
  /** The desktop install id the grant was enrolled under (used to revoke it). */
  desktopInstallId: string;
  /**
   * The full Authorization header value the runtime presents to the gateway MCP
   * endpoint, exactly as the enroll response returns it (already includes the
   * "Bearer " scheme — this is what the worker writes to the dotfile verbatim).
   */
  authorization: string;
  /** The gateway MCP URL the runtime should POST to (server-relative, loopback-safe). */
  mcpUrl: string;
}

/**
 * Provisions a real gateway grant for the durable user by driving the same two
 * endpoints the desktop app drives. `organizationId` scopes the grant so the
 * org-policy overlay applies (required for the toggle-off negative — an
 * org-less grant sees no overlay, per `_org_allows` in service.py).
 */
export async function enrollGatewayWorker(
  authedClient: ApiClient,
  options: { serverUrl: string; organizationId: string; desktopInstallId?: string },
): Promise<GatewayGrant> {
  const desktopInstallId = options.desktopInstallId ?? `release-e2e-t3int-${Date.now()}`;
  const enrollment = await authedClient.post<{ enrollmentToken: string }>(
    "/v1/cloud/workers/desktop/enrollment",
    { desktopInstallId, organizationId: options.organizationId },
  );
  const enrolled = await new ApiClient({ baseUrl: options.serverUrl }).post<{
    workerId: string;
    integrationGateway: { url: string; authorization: string };
  }>("/v1/cloud/worker/enroll", {
    enrollmentToken: enrollment.enrollmentToken,
    machineFingerprint: desktopInstallId,
    hostname: "release-e2e-runner",
  });
  // Take the bearer from the real enroll response, but construct the URL from
  // the loopback server URL the runner actually reaches: the enroll response's
  // `url` derives from the server's configured public cloud base URL, which in
  // CI is not the 127.0.0.1 the runtime can reach.
  const mcpUrl = `${options.serverUrl.replace(/\/+$/, "")}/v1/cloud/integration-gateway/mcp`;
  return {
    workerId: enrolled.workerId,
    desktopInstallId,
    authorization: enrolled.integrationGateway.authorization,
    mcpUrl,
  };
}

/**
 * Writes the integration-gateway dotfile into the runtime home so the running
 * AnyHarness runtime injects the gateway MCP on the next session launch. Atomic
 * write (temp + rename) so a concurrent session launch never reads a partial
 * file. Mirrors the worker's own `write` in
 * anyharness/crates/proliferate-worker/src/integration_gateway.rs.
 */
export async function writeGatewayDotfile(runtimeHome: string, grant: GatewayGrant): Promise<void> {
  await mkdir(runtimeHome, { recursive: true });
  const target = path.join(runtimeHome, GATEWAY_DOTFILE_NAME);
  const tmp = `${target}.tmp-${process.pid}`;
  const contents = JSON.stringify(
    { version: 1, url: grant.mcpUrl, authorization: grant.authorization },
    null,
    2,
  );
  await writeFile(tmp, contents, { mode: 0o600 });
  await rename(tmp, target);
}

/** The runtime home the local runtime reads the gateway dotfile from. */
export function resolveRuntimeHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.ANYHARNESS_RUNTIME_HOME?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  // Desktop/dev default (apps/desktop + anyharness config): ~/.proliferate/anyharness.
  const home = os.homedir();
  return home ? path.join(home, ".proliferate", "anyharness") : undefined;
}

/** Raw POST of a single JSON-RPC message to the gateway MCP endpoint with the worker bearer. */
export async function gatewayJsonRpc(
  grant: GatewayGrant,
  message: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await fetch(grant.mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // grant.authorization already includes the "Bearer " scheme.
      authorization: grant.authorization,
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    parsed = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`gateway ${grant.mcpUrl} -> ${response.status}: ${text}`);
  }
  return parsed as JsonRpcResponse;
}

let nextRpcId = 1;

/** `initialize` — proves the gateway resolves the worker bearer to a grant. */
export async function gatewayInitialize(grant: GatewayGrant): Promise<JsonRpcResponse> {
  return gatewayJsonRpc(grant, { jsonrpc: "2.0", id: nextRpcId++, method: "initialize", params: {} });
}

/** `integrations.list_providers` — the owner's connected, ready providers. */
export async function gatewayListProviders(
  grant: GatewayGrant,
): Promise<Array<{ provider: string; status: string; authKind: string }>> {
  const response = await gatewayJsonRpc(grant, {
    jsonrpc: "2.0",
    id: nextRpcId++,
    method: "tools/call",
    params: { name: "integrations.list_providers", arguments: {} },
  });
  const structured = response.result?.structuredContent as { providers?: Array<{ provider: string; status: string; authKind: string }> } | undefined;
  return structured?.providers ?? [];
}

/** `integrations.list_tools` for one provider — discovers the upstream tool names. */
export async function gatewayListTools(
  grant: GatewayGrant,
  provider: string,
): Promise<Array<{ name: string; inputSchema?: unknown }>> {
  const response = await gatewayJsonRpc(grant, {
    jsonrpc: "2.0",
    id: nextRpcId++,
    method: "tools/call",
    params: { name: "integrations.list_tools", arguments: { provider } },
  });
  if (response.result?.isError) {
    const text = response.result.content?.map((c) => c.text).join(" ") ?? "unknown";
    throw new Error(`gateway list_tools(${provider}) errored: ${text}`);
  }
  const structured = response.result?.structuredContent as { tools?: Array<{ name: string; inputSchema?: unknown }> } | undefined;
  return structured?.tools ?? [];
}

/** `integrations.call_tool` — the audited path (writes cloud_integration_tool_call_event). */
export async function gatewayCallTool(
  grant: GatewayGrant,
  provider: string,
  tool: string,
  toolArguments: Record<string, unknown>,
): Promise<{ isError: boolean; message: string }> {
  const response = await gatewayJsonRpc(grant, {
    jsonrpc: "2.0",
    id: nextRpcId++,
    method: "tools/call",
    params: { name: "integrations.call_tool", arguments: { provider, tool, arguments: toolArguments } },
  });
  const isError = Boolean(response.result?.isError);
  const message = response.result?.content?.map((c) => c.text ?? "").join(" ") ?? "";
  return { isError, message };
}

export interface ToolCallEvent {
  id: string;
  namespace: string;
  toolName: string;
  ok: boolean;
  errorCode: string | null;
  latencyMs: number;
  runtimeWorkerId: string | null;
  organizationId: string | null;
  createdAt: string;
}

/**
 * Runs `tests/release/scripts/integration_audit_probe.py` in-process against
 * the local profile DB (same seam/env contract as `billing.ts`'s
 * `runBillingProbe`). Requires `RELEASE_E2E_LOCAL_DATABASE_URL`.
 */
export async function runIntegrationAuditProbe(
  email: string,
  options: { namespace?: string; sinceSeconds?: number } = {},
): Promise<{ userId: string; events: ToolCallEvent[]; error?: string }> {
  const databaseUrl = process.env.RELEASE_E2E_LOCAL_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "integration_audit_probe: RELEASE_E2E_LOCAL_DATABASE_URL is required (see src/config/env-manifest.ts) — e.g. " +
        "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate_dev_<profile>",
    );
  }
  const scriptPath = path.resolve(import.meta.dirname, "../../scripts/integration_audit_probe.py");
  const serverDir = path.resolve(import.meta.dirname, "../../../../server");
  const args = [scriptPath, "tool-call-events", email];
  if (options.namespace) {
    args.push("--namespace", options.namespace);
  }
  args.push("--since-seconds", String(options.sinceSeconds ?? 3600));
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", ...args], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`integration_audit_probe.py exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const lastLine = stdout.trim().split("\n").pop() ?? "{}";
        resolve(JSON.parse(lastLine));
      } catch (error) {
        reject(new Error(`integration_audit_probe.py did not print valid JSON: ${stdout}\n${error}`));
      }
    });
  });
}

/**
 * Picks the exa web-search tool from a discovered tool list, preferring a
 * name that looks like a web search, and builds minimal valid arguments
 * (a `query` string) from the tool's inputSchema. Pure — unit-tested.
 */
export function pickSearchTool(
  tools: Array<{ name: string; inputSchema?: unknown }>,
  query: string,
): { tool: string; arguments: Record<string, unknown> } | undefined {
  if (tools.length === 0) {
    return undefined;
  }
  const preferred =
    tools.find((t) => /web_?search/i.test(t.name)) ??
    tools.find((t) => /search/i.test(t.name)) ??
    tools[0];
  const schema = (preferred.inputSchema ?? {}) as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  };
  const properties = schema.properties ?? {};
  const args: Record<string, unknown> = {};
  // Fill required fields (and a `query`-shaped field if present) with sane values.
  const required = new Set(schema.required ?? []);
  for (const [key, prop] of Object.entries(properties)) {
    const isQueryish = /query|q|search|text|prompt/i.test(key);
    if (required.has(key) || isQueryish) {
      if (prop.type === "number" || prop.type === "integer") {
        args[key] = 1;
      } else if (prop.type === "boolean") {
        args[key] = false;
      } else {
        args[key] = isQueryish ? query : query;
      }
    }
  }
  if (Object.keys(args).length === 0) {
    args.query = query;
  }
  return { tool: preferred.name, arguments: args };
}
