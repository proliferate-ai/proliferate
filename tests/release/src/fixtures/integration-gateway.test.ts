import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildIntegrationAuditProbeEnv,
  findCorrelatedToolCallEvent,
  parseIntegrationAuditProbeResult,
  pickSearchTool,
  requireIntegrationAuditProbeEvents,
  resolveRuntimeHome,
  type ToolCallAuditCorrelation,
  type ToolCallEvent,
} from "./integration-gateway.js";

function toolCallEvent(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    id: "audit-new",
    namespace: "exa",
    toolName: "web_search",
    ok: true,
    errorCode: null,
    latencyMs: 12,
    runtimeWorkerId: "worker-current",
    organizationId: "org-current",
    createdAt: "2026-07-17T20:00:00.000Z",
    ...overrides,
  };
}

const correlation: ToolCallAuditCorrelation = {
  baselineEventIds: ["audit-old"],
  runtimeWorkerId: "worker-current",
  organizationId: "org-current",
};

test("pickSearchTool prefers a web_search-shaped tool and fills a query arg", () => {
  const picked = pickSearchTool(
    [
      { name: "get_contents", inputSchema: { properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "web_search_exa", inputSchema: { properties: { query: { type: "string" } }, required: ["query"] } },
    ],
    "Proliferate AI",
  );
  assert.ok(picked);
  assert.equal(picked.tool, "web_search_exa");
  assert.equal(picked.arguments.query, "Proliferate AI");
});

test("pickSearchTool falls back to a plain 'search' name", () => {
  const picked = pickSearchTool(
    [{ name: "search", inputSchema: { properties: { q: { type: "string" } }, required: ["q"] } }],
    "hello",
  );
  assert.ok(picked);
  assert.equal(picked.tool, "search");
  assert.equal(picked.arguments.q, "hello");
});

test("pickSearchTool fills required non-query fields with typed defaults", () => {
  const picked = pickSearchTool(
    [
      {
        name: "web_search",
        inputSchema: {
          properties: { query: { type: "string" }, numResults: { type: "integer" }, live: { type: "boolean" } },
          required: ["query", "numResults"],
        },
      },
    ],
    "q",
  );
  assert.ok(picked);
  assert.equal(picked.arguments.query, "q");
  assert.equal(picked.arguments.numResults, 1);
});

test("pickSearchTool defaults to a query arg when the tool has no schema", () => {
  const picked = pickSearchTool([{ name: "mystery" }], "term");
  assert.ok(picked);
  assert.equal(picked.tool, "mystery");
  assert.equal(picked.arguments.query, "term");
});

test("pickSearchTool returns undefined for an empty tool list", () => {
  assert.equal(pickSearchTool([], "x"), undefined);
});

test("resolveRuntimeHome prefers ANYHARNESS_RUNTIME_HOME", () => {
  assert.equal(resolveRuntimeHome({ ANYHARNESS_RUNTIME_HOME: "/tmp/rt" }), "/tmp/rt");
});

test("resolveRuntimeHome falls back to the desktop default under HOME", () => {
  const resolved = resolveRuntimeHome({});
  assert.ok(resolved && resolved.endsWith("/.proliferate/anyharness"));
});

test("integration audit probe adds the Settings posture missing from the legacy DATABASE_URL-only spawn", () => {
  const databaseUrl = "postgresql+asyncpg://probe@127.0.0.1:5432/probe";
  const legacyEnv: NodeJS.ProcessEnv = { DATABASE_URL: databaseUrl };
  assert.equal(legacyEnv.DEBUG, undefined);
  assert.equal(legacyEnv.PROLIFERATE_TELEMETRY_MODE, undefined);

  const env = buildIntegrationAuditProbeEnv(databaseUrl, {});
  assert.equal(env.DATABASE_URL, databaseUrl);
  assert.equal(env.DEBUG, "true");
  assert.equal(env.PROLIFERATE_TELEMETRY_MODE, "local_dev");
  assert.equal(env.RUN_BACKGROUND_WORKERS, "false");
  assert.equal(env.AGENT_GATEWAY_QUALIFICATION_RUN_ID, "");
  assert.equal(env.AGENT_GATEWAY_QUALIFICATION_SHARD_ID, "");
});

test("integration audit probe posture overrides unsafe ambient production settings only in its child env", () => {
  const ambient: NodeJS.ProcessEnv = {
    debug: "false",
    proliferate_telemetry_mode: "hosted_product",
    telemetry_mode: "self_managed",
    run_background_workers: "true",
    agent_gateway_qualification_run_id: "incomplete-parent-identity",
    agent_gateway_qualification_shard_id: "bad shard with spaces",
    database_url: "postgresql+asyncpg://wrong-database",
    UNRELATED_ENV: "preserved",
  };
  const env = buildIntegrationAuditProbeEnv("postgresql+asyncpg://probe", ambient);

  assert.equal(env.DEBUG, "true");
  assert.equal(env.PROLIFERATE_TELEMETRY_MODE, "local_dev");
  assert.equal(env.RUN_BACKGROUND_WORKERS, "false");
  assert.equal(env.AGENT_GATEWAY_QUALIFICATION_RUN_ID, "");
  assert.equal(env.AGENT_GATEWAY_QUALIFICATION_SHARD_ID, "");
  assert.equal(env.DATABASE_URL, "postgresql+asyncpg://probe");
  assert.equal(env.UNRELATED_ENV, "preserved");
  for (const ownedKey of [
    "DATABASE_URL",
    "DEBUG",
    "PROLIFERATE_TELEMETRY_MODE",
    "TELEMETRY_MODE",
    "RUN_BACKGROUND_WORKERS",
    "AGENT_GATEWAY_QUALIFICATION_RUN_ID",
    "AGENT_GATEWAY_QUALIFICATION_SHARD_ID",
  ]) {
    const matchingKeys = Object.keys(env).filter(
      (key) => key.toUpperCase() === ownedKey,
    );
    assert.equal(
      matchingKeys.length,
      ownedKey === "TELEMETRY_MODE" ? 0 : 1,
      `${ownedKey} must not retain a case-insensitive ambient collision`,
    );
  }
  assert.equal(
    ambient.debug,
    "false",
    "the parent/production environment must not be mutated",
  );
});

test("integration audit probe propagates a real query failure instead of returning empty evidence", () => {
  assert.throws(
    () => parseIntegrationAuditProbeResult(1, "", "ConnectionRefusedError: audit query failed"),
    /integration_audit_probe\.py exited 1: ConnectionRefusedError: audit query failed/,
  );
});

test("integration audit probe reports a signal-killed child unambiguously", () => {
  assert.throws(
    () => parseIntegrationAuditProbeResult(null, "", "terminated", "SIGTERM"),
    /integration_audit_probe\.py was killed by SIGTERM: terminated/,
  );
});

test("audit correlation returns no evidence when the tool call left no row", () => {
  assert.equal(
    findCorrelatedToolCallEvent([], { namespace: "exa", toolName: "web_search", correlation }),
    undefined,
  );
});

test("audit correlation rejects a probe result resolved to the wrong actor", () => {
  assert.throws(
    () => requireIntegrationAuditProbeEvents({ userId: "user-other", events: [] }, "user-current"),
    /resolved user "user-other"; expected "user-current"/,
  );
});

test("stale and incorrectly correlated visible tool calls cannot satisfy LOCAL-7", () => {
  const unrelated = [
    toolCallEvent({ id: "audit-old" }),
    toolCallEvent({ id: "wrong-worker", runtimeWorkerId: "worker-other" }),
    toolCallEvent({ id: "wrong-org", organizationId: "org-other" }),
    toolCallEvent({ id: "wrong-provider", namespace: "github" }),
    toolCallEvent({ id: "wrong-tool", toolName: "get_contents" }),
    toolCallEvent({ id: "failed-call", ok: false, errorCode: "tool_error" }),
    toolCallEvent({ id: "ok-but-errored", errorCode: "partial_error" }),
  ];

  assert.equal(
    findCorrelatedToolCallEvent(unrelated, {
      namespace: "exa",
      toolName: "web_search",
      correlation,
    }),
    undefined,
  );
});

test("audit correlation accepts the new successful row from the exact worker and organization", () => {
  const exact = toolCallEvent({ id: "audit-exact" });
  assert.equal(
    findCorrelatedToolCallEvent([toolCallEvent({ id: "audit-old" }), exact], {
      namespace: "exa",
      toolName: "web_search",
      correlation,
    }),
    exact,
  );
});
