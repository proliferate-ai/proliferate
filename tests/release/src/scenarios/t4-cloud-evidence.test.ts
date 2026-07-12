import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QUALIFICATION_MCP_TOOL,
  assertAgentArtifactsMatchPins,
  assertQualificationMcpApplied,
  assertReconcileCompletedForAgent,
  assertSameDurableSession,
  assertServedCatalogMatchesCandidate,
  assertTerminalTurnEvidence,
  selectQualificationAgent,
  type QualificationCatalogDocument,
  type RuntimeSessionEventEnvelope,
  type RuntimeSessionSummary,
} from "./upgrade/t4-cloud-evidence.js";

function catalog(overrides: Partial<QualificationCatalogDocument> = {}): QualificationCatalogDocument {
  return {
    catalogVersion: "candidate-catalog-v2",
    probedAgainst: { registryVersion: "candidate-registry-v2" },
    agents: [
      {
        kind: "claude",
        harness: {
          native: { version: "2.1.181" },
          agentProcess: { version: "0.44.0" },
        },
      },
      {
        kind: "codex",
        harness: {
          native: { version: "rust-v0.144.1" },
          agentProcess: { version: "0.17.0-proliferate.1" },
        },
      },
    ],
    ...overrides,
  };
}

function session(overrides: Partial<RuntimeSessionSummary> = {}): RuntimeSessionSummary {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    agentKind: "claude",
    nativeSessionId: "native-1",
    status: "idle",
    mcpBindingSummaries: [
      {
        id: "internal:subagents",
        serverName: "subagents",
        transport: "http",
        outcome: "applied",
      },
    ],
    ...overrides,
  };
}

function event(
  seq: number,
  turnId: string,
  payload: RuntimeSessionEventEnvelope["event"],
): RuntimeSessionEventEnvelope {
  return { sessionId: "session-1", seq, turnId, event: payload };
}

test("served catalog must match the candidate registry pairing and every artifact pin", () => {
  assert.doesNotThrow(() => assertServedCatalogMatchesCandidate(catalog(), catalog()));
  assert.throws(
    () =>
      assertServedCatalogMatchesCandidate(
        catalog(),
        catalog({
          agents: [
            {
              kind: "claude",
              harness: {
                native: { version: "2.1.180" },
                agentProcess: { version: "0.44.0" },
              },
            },
          ],
        }),
      ),
    /artifact pins/,
  );
  assert.throws(
    () =>
      assertServedCatalogMatchesCandidate(
        catalog(),
        catalog({ probedAgainst: { registryVersion: "old-registry" } }),
      ),
    /candidate registry/,
  );
});

test("qualification selection respects --agents and prefers a cheap real model", () => {
  const launchOptions = {
    agents: [
      {
        kind: "codex",
        defaultModelId: "openai.gpt-5.5",
        models: [{ id: "openai.gpt-5.5" }, { id: "openai.gpt-5-mini" }],
      },
      {
        kind: "claude",
        defaultModelId: "opus",
        models: [{ id: "opus" }, { id: "claude-haiku" }, { id: "sonnet" }],
      },
    ],
  };

  const all = selectQualificationAgent(["all"], launchOptions, catalog());
  assert.deepEqual(all, {
    kind: "claude",
    modelId: "claude-haiku",
    expectedNativeVersion: "2.1.181",
    expectedAgentProcessVersion: "0.44.0",
  });

  const codex = selectQualificationAgent(["codex"], launchOptions, catalog());
  assert.equal(codex.kind, "codex");
  assert.equal(codex.modelId, "openai.gpt-5-mini");
  assert.throws(() => selectQualificationAgent(["cursor"], launchOptions, catalog()), /no runnable cheap/);
});

test("artifact and startup-reconcile evidence fail closed on an adapter mismatch", () => {
  const expected = selectQualificationAgent(
    ["claude"],
    { agents: [{ kind: "claude", models: [{ id: "haiku" }] }] },
    catalog(),
  );
  assert.doesNotThrow(() =>
    assertAgentArtifactsMatchPins(
      {
        kind: "claude",
        installState: "installed",
        readiness: "ready",
        native: { installed: true, version: "2.1.181", path: "/managed/claude" },
        agentProcess: { installed: true, version: "0.44.0", path: "/managed/claude-acp" },
      },
      expected,
    ),
  );
  assert.throws(
    () =>
      assertAgentArtifactsMatchPins(
        {
          kind: "claude",
          installState: "installed",
          readiness: "ready",
          native: { installed: true, version: "2.1.181", path: "/managed/claude" },
          agentProcess: { installed: true, version: "0.43.0", path: "/managed/claude-acp" },
        },
        expected,
      ),
    /adapter version/,
  );

  assert.doesNotThrow(() =>
    assertReconcileCompletedForAgent(
      {
        status: "completed",
        jobId: "reconcile-1",
        results: [{ kind: "claude", outcome: "already_installed" }],
      },
      "claude",
    ),
  );
  assert.throws(
    () =>
      assertReconcileCompletedForAgent(
        {
          status: "completed",
          jobId: "reconcile-1",
          results: [{ kind: "claude", outcome: "failed", message: "checksum mismatch" }],
        },
        "claude",
      ),
    /did not converge/,
  );
});

test("same durable session and applied MCP configuration are exact assertions", () => {
  assert.doesNotThrow(() => assertQualificationMcpApplied(session()));
  assert.doesNotThrow(() => assertSameDurableSession(session(), session({ nativeSessionId: "native-2" })));
  assert.throws(
    () =>
      assertQualificationMcpApplied(
        session({
          mcpBindingSummaries: [
            {
              id: "internal:subagents",
              serverName: "subagents",
              transport: "http",
              outcome: "not_applied",
              reason: "needs_reconnect",
            },
          ],
        }),
      ),
    /not applied/,
  );
  assert.throws(() => assertSameDurableSession(session(), session({ id: "session-2" })), /session id/);
});

test("terminal evidence requires the exact completed MCP invocation in the successful turn", () => {
  const events = [
    event(11, "turn-post-update", { type: "turn_started" }),
    event(12, "turn-post-update", {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        toolCallId: "tool-1",
        nativeToolName: QUALIFICATION_MCP_TOOL,
        rawOutput: { subagents: [] },
      },
    }),
    event(13, "turn-post-update", { type: "turn_ended", stopReason: "end_turn" }),
  ];
  assert.deepEqual(assertTerminalTurnEvidence(events, 10, QUALIFICATION_MCP_TOOL), {
    turnId: "turn-post-update",
    terminalSeq: 13,
    toolSeq: 12,
  });

  assert.throws(
    () =>
      assertTerminalTurnEvidence(
        [
          event(11, "turn-post-update", {
            type: "item_completed",
            item: {
              kind: "tool_invocation",
              status: "completed",
              toolCallId: "tool-1",
              nativeToolName: "mcp__other__list_subagents",
            },
          }),
          event(12, "turn-post-update", { type: "turn_ended", stopReason: "end_turn" }),
        ],
        10,
        QUALIFICATION_MCP_TOOL,
      ),
    /no completed structured tool invocation/,
  );
  assert.throws(
    () =>
      assertTerminalTurnEvidence(
        [
          event(11, "turn-post-update", { type: "error", message: "MCP transport failed" }),
          event(12, "turn-post-update", { type: "turn_ended", stopReason: "end_turn" }),
        ],
        10,
      ),
    /MCP transport failed/,
  );
  assert.throws(
    () => assertTerminalTurnEvidence([event(12, "turn", { type: "turn_started" }), event(11, "turn", { type: "turn_ended", stopReason: "end_turn" })], 10),
    /not strictly increasing/,
  );
});
