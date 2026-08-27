import { describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import {
  runFirstRunAuthAdoption,
  settleFirstRunAuthAdoptionFailure,
  type FreshAgentCatalogResult,
  type RunFirstRunAuthAdoptionDeps,
} from "#product/lib/workflows/agents/first-run-auth-adoption";
import type { RendererDiagnosticInput } from "#product/lib/infra/diagnostics/renderer-diagnostics-port";


function agent(kind: string): AgentSummary {
  return {
    kind,
    displayName: kind,
    credentialState: "login_required",
    installState: "installed",
    readiness: "credentials_required",
    supportsLogin: true,
  } as AgentSummary;
}

function createDeps(
  overrides: Partial<RunFirstRunAuthAdoptionDeps> = {},
): RunFirstRunAuthAdoptionDeps {
  return {
    recordAdoption: vi.fn(),
    recordDiagnostic: vi.fn(),
    readFreshAgents: vi.fn(async () => ({
      kind: "success" as const,
      agents: [],
    })),
    loadPlanner: vi.fn(async () => () => []),
    writeSelection: vi.fn(),
    ...overrides,
  };
}

function diagnosticValues(input: RendererDiagnosticInput) {
  return Object.fromEntries(
    Object.entries(input.fields ?? {}).map(([key, field]) => [key, field.value]),
  );
}

describe("runFirstRunAuthAdoption", () => {
  it("does nothing before the fresh catalog read resolves", async () => {
    let resolveFresh!: (result: FreshAgentCatalogResult) => void;
    const deps = createDeps({
      readFreshAgents: vi.fn(() => new Promise((resolve) => {
        resolveFresh = resolve;
      })),
    });

    const run = runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );
    await Promise.resolve();

    expect(deps.recordAdoption).not.toHaveBeenCalled();
    expect(deps.recordDiagnostic).not.toHaveBeenCalled();
    expect(deps.loadPlanner).not.toHaveBeenCalled();
    expect(deps.writeSelection).not.toHaveBeenCalled();

    resolveFresh({ kind: "success", agents: [] });
    await run;
  });

  it("plans only from the freshly resolved catalog", async () => {
    const freshAgents = [agent("codex")];
    const planner = vi.fn(() => [
      { harnessKind: "codex", surface: "local" as const },
    ]);
    const deps = createDeps({
      readFreshAgents: vi.fn(async () => ({
        kind: "success" as const,
        agents: freshAgents,
      })),
      loadPlanner: vi.fn(async () => planner),
    });

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );

    expect(planner).toHaveBeenCalledWith({
      agents: freshAgents,
      selectionCount: 0,
      gatewayEnabled: true,
    });
    expect(deps.recordAdoption).toHaveBeenCalledWith(["codex"]);
  });

  it("settles a successful fresh empty catalog without a diagnostic or write", async () => {
    const deps = createDeps();

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );

    expect(deps.recordAdoption).toHaveBeenCalledWith([]);
    expect(deps.recordDiagnostic).not.toHaveBeenCalled();
    expect(deps.writeSelection).not.toHaveBeenCalled();
  });

  it.each([
    [
      "typed result",
      async (): Promise<FreshAgentCatalogResult> => ({
        kind: "failure",
        error: new TypeError("secret result"),
      }),
    ],
    ["rejection", async () => { throw new TypeError("secret rejection"); }],
  ] as const)("settles and diagnoses a fresh-catalog %s", async (_label, readFreshAgents) => {
    const deps = createDeps({ readFreshAgents: vi.fn(readFreshAgents) });

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );

    expect(deps.recordAdoption).toHaveBeenCalledWith([]);
    expect(deps.recordAdoption).toHaveBeenCalledTimes(1);
    expect(deps.loadPlanner).not.toHaveBeenCalled();
    const diagnostic = vi.mocked(deps.recordDiagnostic).mock.calls[0]![0];
    expect(diagnosticValues(diagnostic)).toEqual({
      failure_stage: "agent_catalog_query",
      error_name: "TypeError",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });

  it("settles and diagnoses a lazy planner loader rejection", async () => {
    const deps = createDeps({
      loadPlanner: vi.fn(async () => {
        throw new SyntaxError("private chunk URL");
      }),
    });

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );

    expect(deps.recordAdoption).toHaveBeenCalledWith([]);
    const diagnostic = vi.mocked(deps.recordDiagnostic).mock.calls[0]![0];
    expect(diagnosticValues(diagnostic)).toEqual({
      failure_stage: "planner_import",
      error_name: "SyntaxError",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private chunk URL");
  });

  it("settles and diagnoses a loaded planner throw", async () => {
    const deps = createDeps({
      loadPlanner: vi.fn(async () => () => {
        throw new RangeError("private planner payload");
      }),
    });

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );

    expect(deps.recordAdoption).toHaveBeenCalledWith([]);
    const diagnostic = vi.mocked(deps.recordDiagnostic).mock.calls[0]![0];
    expect(diagnosticValues(diagnostic)).toEqual({
      failure_stage: "planner",
      error_name: "RangeError",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private planner payload");
  });

  it("records a successful empty plan without a failure diagnostic", async () => {
    const deps = createDeps({
      readFreshAgents: vi.fn(async () => ({
        kind: "success" as const,
        agents: [agent("claude")],
      })),
      loadPlanner: vi.fn(async () => () => []),
    });

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: false },
      deps,
    );

    expect(deps.recordAdoption).toHaveBeenCalledWith([]);
    expect(deps.recordDiagnostic).not.toHaveBeenCalled();
    expect(deps.writeSelection).not.toHaveBeenCalled();
  });

  it("records once before dispatching multiple writes in planner order", async () => {
    const calls: string[] = [];
    const recordAdoption = vi.fn((kinds: readonly string[]) => {
      calls.push(`record:${kinds.join(",")}`);
    });
    const writeSelection = vi.fn((action: { harnessKind: string }) => {
      calls.push(`write:${action.harnessKind}`);
    });
    const deps = createDeps({
      recordAdoption,
      readFreshAgents: vi.fn(async () => ({
        kind: "success" as const,
        agents: [agent("claude"), agent("codex")],
      })),
      loadPlanner: vi.fn(async () => () => [
        { harnessKind: "claude", surface: "local" as const },
        { harnessKind: "codex", surface: "local" as const },
      ]),
      writeSelection,
    });

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );

    expect(recordAdoption).toHaveBeenCalledTimes(1);
    expect(recordAdoption).toHaveBeenCalledWith(["claude", "codex"]);
    expect(calls).toEqual([
      "record:claude,codex",
      "write:claude",
      "write:codex",
    ]);
  });

  it("bounds a selection-write diagnostic to its fixed fields", async () => {
    let onError!: (error: unknown) => void;
    const deps = createDeps({
      readFreshAgents: vi.fn(async () => ({
        kind: "success" as const,
        agents: [agent("claude")],
      })),
      loadPlanner: vi.fn(async () => () => [
        { harnessKind: "claude", surface: "local" as const },
      ]),
      writeSelection: vi.fn((_action, callback) => {
        onError = callback;
      }),
    });

    await runFirstRunAuthAdoption(
      { selectionCount: 0, gatewayEnabled: true },
      deps,
    );
    onError(Object.assign(new TypeError("raw response"), {
      payload: { token: "secret-token" },
    }));

    const diagnostic = vi.mocked(deps.recordDiagnostic).mock.calls[0]![0];
    expect(diagnosticValues(diagnostic)).toEqual({
      failure_stage: "selection_write",
      error_name: "TypeError",
      harness_kind: "claude",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("raw response");
    expect(JSON.stringify(diagnostic)).not.toContain("secret-token");
  });
});

describe("settleFirstRunAuthAdoptionFailure", () => {
  it("records the empty settlement before diagnostics and omits non-write harness ids", () => {
    const calls: string[] = [];
    const recordDiagnostic = vi.fn((input: RendererDiagnosticInput) => {
      calls.push("diagnostic");
      expect(diagnosticValues(input)).toEqual({
        failure_stage: "reconcile_job",
      });
    });

    settleFirstRunAuthAdoptionFailure(
      {
        stage: "reconcile_job",
        harnessKind: "must-not-ship",
      },
      {
        recordAdoption: (kinds) => {
          calls.push("settlement");
          expect(kinds).toEqual([]);
        },
        recordDiagnostic,
      },
    );

    expect(calls).toEqual(["settlement", "diagnostic"]);
  });
});
