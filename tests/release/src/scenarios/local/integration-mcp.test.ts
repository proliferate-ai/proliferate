import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NoEligibleMcpModelError,
  buildLocalMcpIntegrationEvidence,
  runLocal7McpCellsAgainstWorld,
  type LocalMcpDriver,
} from "./integration-mcp.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { AuthenticatedActor } from "../../fixtures/authenticated-actor.js";
import type { PreparedRepository } from "../../fixtures/prepared-repository.js";
import type { ProductPage } from "../../fixtures/product-page.js";
import type { LocalCleanupV1 } from "../../evidence/schema.js";
import type { LocalWorldCleanupEvidence } from "../../worlds/local-workspace/cleanup.js";
import type { ReadyLocalWorld } from "../../worlds/local-workspace/world.js";

function fakeWorld(closeImpl?: () => Promise<LocalWorldCleanupEvidence>): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: {
      run_id: "local-run-1",
      shard_id: "local-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    artifacts: {
      server: { artifact_id: "server/linux-amd64", version: "1.2.3", sha256: "s".repeat(64), path: "/tmp/server" },
      anyharness: {
        artifact_id: "anyharness/x86_64-unknown-linux-gnu",
        version: "4.5.6",
        sha256: "a".repeat(64),
        path: "/tmp/anyharness",
      },
      desktopRenderer: {
        artifact_id: "desktop-renderer/browser",
        version: "1",
        sha256: "d".repeat(64),
        path: "/tmp/renderer",
      },
    },
    api: undefined as never,
    runtime: undefined as never,
    renderer: undefined as never,
    gateway: undefined as never,
    paths: undefined as never,
    db: { databaseUrl: "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5599/proliferate" },
    close: closeImpl ?? (async () => cleanCleanupEvidence()),
  };
}

function cleanCleanupEvidence(overrides: Partial<LocalWorldCleanupEvidence> = {}): LocalWorldCleanupEvidence {
  return {
    ledgerIdHash: "e".repeat(64),
    registered: 4,
    reconciled: 4,
    failed: 0,
    virtualKeyDeleted: true,
    litellmSubjectsDeleted: true,
    browserClosed: true,
    processesStopped: true,
    containersRemoved: true,
    localPathsRemoved: true,
    ...overrides,
  };
}

function fakeCell(harness: string): PlannedCellV1 {
  return {
    cell_id: `T3-INT-1/local/harness=${harness}`,
    scenario_id: "T3-INT-1",
    registry_flow_ref: "specs/developing/testing/scenarios.md#T3-INT-1",
    runtime_lane: "local",
    dimensions: { harness },
    required_env: [],
  };
}

function fakeActor(harness: string): AuthenticatedActor {
  return {
    role: "owner",
    userId: `user-${harness}`,
    organizationId: `org-${harness}`,
    enrollmentId: `enroll-${harness}`,
    api: undefined as never,
    session: {
      access_token: "tok",
      refresh_token: "ref",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      user_id: `user-${harness}`,
      email: `qual-owner-${harness}@example.com`,
      display_name: null,
    },
    gatewayKey: {
      userId: `user-${harness}`,
      enrollmentId: `enroll-${harness}`,
      teamId: "team",
      litellmUserId: `llm-${harness}`,
      keyAlias: `vk-user-${harness}`,
      tokenId: `token-${harness}`,
      tokenIdHash: `hash-${harness}`,
    },
  };
}

function fakePage(): ProductPage {
  return {
    context: undefined as never,
    page: undefined as never,
    debug: { console: [], network: [] },
    close: async () => undefined,
  };
}

function fakeRepo(): PreparedRepository {
  return { path: "/tmp/repo", repoUrl: "https://github.com/x/y.git", commit: "c".repeat(40), repoRootId: "root-1" };
}

/** A driver whose every step succeeds deterministically for a fixed harness set. */
function greenDriver(closedCount: { value: number }): LocalMcpDriver {
  return {
    createActor: async (_world, harness) => fakeActor(harness),
    prepareRepo: async () => fakeRepo(),
    openPage: async () => fakePage(),
    ensureHarnessReady: async () => undefined,
    connectIntegration: async () => undefined,
    selectRepoAndWorkLocally: async () => undefined,
    runIntegrationTurn: async (_world, _page, harness) => ({
      workspaceId: `ws-${harness}`,
      sessionId: `sess-${harness}`,
      modelId: "us.anthropic.claude-haiku-4-6",
      toolName: "web_search",
    }),
    assertAuditRow: async (_world, _actor, _namespace, _toolName) => ({ auditEventId: "audit-1" }),
    closeWorld: async (world) => {
      closedCount.value += 1;
      return world.close();
    },
  };
}

test("runLocal7McpCellsAgainstWorld: every cell green with complete evidence, world closed exactly once", async () => {
  const closed = { value: 0 };
  const world = fakeWorld();
  const driver = greenDriver(closed);
  const cells = [fakeCell("claude"), fakeCell("codex")];

  const outcomes = await runLocal7McpCellsAgainstWorld(world, cells, driver);

  assert.equal(outcomes.length, 2);
  assert.equal(closed.value, 1);
  for (const [index, outcome] of outcomes.entries()) {
    assert.equal(outcome.status, "green");
    assert.ok(outcome.evidence);
    assert.equal(outcome.evidence!.kind, "local_mcp_integration");
    assert.equal(outcome.cellId, cells[index]!.cell_id);
  }
});

test("runLocal7McpCellsAgainstWorld: a per-cell failure does not affect its sibling", async () => {
  const closed = { value: 0 };
  const world = fakeWorld();
  const base = greenDriver(closed);
  const driver: LocalMcpDriver = {
    ...base,
    runIntegrationTurn: async (_world, _page, harness) => {
      if (harness === "cursor") {
        throw new Error("cursor turn errored");
      }
      return { workspaceId: `ws-${harness}`, sessionId: `sess-${harness}`, modelId: "m", toolName: "web_search" };
    },
  };
  const cells = [fakeCell("claude"), fakeCell("cursor")];

  const outcomes = await runLocal7McpCellsAgainstWorld(world, cells, driver);

  assert.equal(outcomes[0]!.status, "green");
  assert.equal(outcomes[1]!.status, "failed");
  assert.match(outcomes[1]!.reason!.message, /cursor turn errored/);
});

test("runLocal7McpCellsAgainstWorld: no eligible model maps to a typed blocked cell, not failed", async () => {
  const closed = { value: 0 };
  const world = fakeWorld();
  const base = greenDriver(closed);
  const driver: LocalMcpDriver = {
    ...base,
    runIntegrationTurn: async () => {
      throw new NoEligibleMcpModelError("[grok] no eligible model");
    },
  };
  const cells = [fakeCell("grok")];

  const outcomes = await runLocal7McpCellsAgainstWorld(world, cells, driver);

  assert.equal(outcomes[0]!.status, "blocked");
  assert.equal(outcomes[0]!.reason!.code, "scenario_blocked");
  assert.equal(outcomes[0]!.evidence, undefined);
});

test("runLocal7McpCellsAgainstWorld: cleanup failure fails every otherwise-green cell", async () => {
  const world = fakeWorld(async () => cleanCleanupEvidence({ failed: 1, browserClosed: false }));
  const driver = greenDriver({ value: 0 });
  const cells = [fakeCell("claude"), fakeCell("codex")];

  const outcomes = await runLocal7McpCellsAgainstWorld(world, cells, driver);

  for (const outcome of outcomes) {
    assert.equal(outcome.status, "failed");
    assert.match(outcome.reason!.message, /cleanup did not fully reconcile/);
    assert.equal(outcome.evidence, undefined);
  }
});

test("runLocal7McpCellsAgainstWorld: world.close() throwing fails every otherwise-green cell", async () => {
  const world = fakeWorld(async () => {
    throw new Error("close exploded");
  });
  const driver = greenDriver({ value: 0 });
  const cells = [fakeCell("claude")];

  const outcomes = await runLocal7McpCellsAgainstWorld(world, cells, driver);

  assert.equal(outcomes[0]!.status, "failed");
  assert.match(outcomes[0]!.reason!.message, /world cleanup failed/);
});

test("buildLocalMcpIntegrationEvidence: assembles a well-formed local_mcp_integration record", () => {
  const cleanup: LocalCleanupV1 = {
    ledger_id_hash: "e".repeat(64),
    registered: 1,
    reconciled: 1,
    failed: 0,
    virtual_key_deleted: true,
    litellm_subjects_deleted: true,
    browser_closed: true,
    processes_stopped: true,
    containers_removed: true,
    local_paths_removed: true,
  };
  const evidence = buildLocalMcpIntegrationEvidence({
    harness: "claude",
    artifactIds: ["server/linux-amd64", "anyharness/x86_64-unknown-linux-gnu", "desktop-renderer/browser"],
    serverVersion: "1.2.3",
    anyharnessVersion: "4.5.6",
    modelId: "us.anthropic.claude-haiku-4-6",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    integrationNamespace: "exa",
    toolName: "web_search",
    auditEventId: "audit-1",
    cleanup,
  });

  assert.equal(evidence.kind, "local_mcp_integration");
  assert.equal(evidence.harness, "claude");
  assert.equal(evidence.integration_namespace, "exa");
  assert.equal(evidence.tool_name, "web_search");
  assert.equal(evidence.audit_ok, true);
  assert.match(evidence.workspace_id_hash, /^[0-9a-f]{64}$/);
  assert.match(evidence.session_id_hash, /^[0-9a-f]{64}$/);
  assert.match(evidence.audit_event_id_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(evidence.cleanup, cleanup);
});
