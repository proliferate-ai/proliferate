import { AnyHarnessClient, type AgentSummary } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  createAgentsPlaygroundRuntimeTransport,
} from "#product/pages/agents-playground/agents-playground-runtime-client";

const LOCAL_RUNTIME_URL = "http://agents-playground.runtime";
const CLOUD_RUNTIME_URL =
  "http://agents-playground.cloud/v1/gateway/cloud-sandbox/anyharness";

const INSTALL_REQUIRED_AGENT: AgentSummary = {
  kind: "claude",
  displayName: "Claude Code",
  readiness: "install_required",
  supportsLogin: true,
  cliAuthState: "absent",
  credentialState: "unknown",
  installState: "install_required",
  nativeRequired: true,
  native: { installed: false, role: "native_cli", version: null },
  agentProcess: { installed: false, role: "agent_process", version: null },
  expectedEnvVars: ["ANTHROPIC_API_KEY"],
  message: null,
};

describe("Agents playground runtime transport", () => {
  it("keeps Cloud install, invalidation reads, and progress inside the fake runtime", async () => {
    const transport = createAgentsPlaygroundRuntimeTransport({
      runtimeUrls: [LOCAL_RUNTIME_URL, CLOUD_RUNTIME_URL],
      agent: INSTALL_REQUIRED_AGENT,
      reconcile: {
        status: "idle",
        reinstall: false,
        installedOnly: false,
        results: [],
      },
    });
    const cloudClient = new AnyHarnessClient({
      baseUrl: CLOUD_RUNTIME_URL,
      authToken: "fixture-token",
      fetch: transport.fetch,
    });

    await expect(cloudClient.agents.list()).resolves.toEqual([INSTALL_REQUIRED_AGENT]);
    await expect(cloudClient.agents.reconcile({
      reinstall: true,
      agentKinds: ["claude"],
    })).resolves.toEqual(expect.objectContaining({ status: "running" }));
    await expect(cloudClient.agents.getReconcileStatus()).resolves.toEqual(
      expect.objectContaining({
        status: "running",
        progress: expect.objectContaining({ totalComponents: 2 }),
      }),
    );
    await expect(cloudClient.agents.list()).resolves.toEqual([
      expect.objectContaining({ installState: "installing" }),
    ]);

    expect(transport.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/agents",
      "POST /v1/agents/reconcile",
      "GET /v1/agents/reconcile",
      "GET /v1/agents",
    ]);
  });

  it("rejects undeclared and non-fixture routes without changing state", async () => {
    const transport = createAgentsPlaygroundRuntimeTransport({
      runtimeUrls: [LOCAL_RUNTIME_URL, CLOUD_RUNTIME_URL],
      agent: INSTALL_REQUIRED_AGENT,
      reconcile: {
        status: "idle",
        reinstall: false,
        installedOnly: false,
        results: [],
      },
    });
    const initialState = transport.snapshot();

    await expect(transport.fetch(
      `${LOCAL_RUNTIME_URL}/v1/agents/not-a-real-route/claude`,
    )).rejects.toThrow("Unhandled Agents playground runtime request");
    await expect(transport.fetch(
      "https://api.proliferate.example/v1/agents",
    )).rejects.toThrow("Agents playground runtime forbids network access");
    expect(transport.snapshot()).toEqual(initialState);
  });
});
