import { describe, expect, it } from "vitest";

import {
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  type WorkflowDefinition,
} from "./definition";
import {
  iterReferences,
  templateSuggestions,
  validateStringReferences,
} from "./interpolation";
import { validateWorkflowDefinition } from "./validation";
import {
  coerceRunStatus,
  deriveStepRunViews,
  isTerminalRunStatus,
  workflowRunStatusDetail,
  workflowRunStatusLabel,
  workflowRunStatusTone,
} from "./run-status";
import { WORKFLOW_TEMPLATES } from "./templates";
import { goalRailLine, workflowStepStrip } from "./presentation";
import { deriveEffectiveConfigs, deriveScopeGroups } from "./effective-config";
import { buildWorkflowRunRow } from "./model";

describe("interpolation", () => {
  it("parses input and emit references", () => {
    const refs = iterReferences("fix {{inputs.repo}} using {{diff.summary}}");
    expect(refs).toEqual([
      { kind: "input", name: "repo" },
      { kind: "emit", emit: "diff", field: "summary" },
    ]);
  });

  it("flags unknown inputs and forward emit references", () => {
    const inputNames = new Set(["repo"]);
    expect(
      validateStringReferences("{{inputs.missing}}", { inputNames, priorEmitNames: new Set() }).map(
        (i) => i.code,
      ),
    ).toEqual(["unknown_input_reference"]);
    expect(
      validateStringReferences("{{verdict.field}}", {
        inputNames,
        priorEmitNames: new Set(),
      }).map((i) => i.code),
    ).toEqual(["forward_emit_reference"]);
    expect(
      validateStringReferences("{{verdict.field}}", {
        inputNames,
        priorEmitNames: new Set(["verdict"]),
      }),
    ).toEqual([]);
  });

  it("rejects malformed placeholders and ignores escaped braces", () => {
    expect(
      validateStringReferences("{{ not a ref }}", {
        inputNames: new Set(),
        priorEmitNames: new Set(),
      }).map((i) => i.code),
    ).toEqual(["invalid_template_reference"]);
    expect(iterReferences("\\{{inputs.repo}}")).toEqual([]);
  });

  it("suggests only inputs and strictly-earlier emit fields", () => {
    const suggestions = templateSuggestions({
      inputs: [{ name: "repo", type: "text" }],
      priorEmits: [{ emit: "diff", stepLabel: "Write output", fieldNames: ["summary"] }],
    });
    expect(suggestions.map((s) => s.token)).toEqual([
      "{{inputs.repo}}",
      "{{diff.summary}}",
    ]);
  });
});

describe("definition parse/serialize", () => {
  it("round-trips a canonical wire dict", () => {
    const wire = {
      version: 1,
      inputs: [{ name: "repo", type: "text", required: true }],
      integrations: ["slack"],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [
            {
              kind: "agent.prompt",
              on_fail: { kind: "retry", n: 2 },
              prompt: "fix {{inputs.repo}}",
              goal: {
                objective: "green",
                max_turns: 25,
                max_wall_secs: 5400,
                token_budget: 400000,
                on_blocked: "notify",
                verify: { shell: "make test", expect_exit: 0 },
              },
            },
            { kind: "shell.run", on_fail: { kind: "stop" }, command: "make test", output_name: "t" },
          ],
        },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(parsed.agents[0]!.harness).toBe("claude");
    expect(parsed.agents[0]!.steps[0]).toMatchObject({
      kind: "agent.prompt",
      onFail: { kind: "retry", n: 2 },
    });
    expect(serializeWorkflowDefinition(parsed)).toEqual(wire);
  });

  it("round-trips an agent.config (switch-model) step", () => {
    const wire = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [
            { kind: "agent.config", on_fail: { kind: "stop" }, model: "opus" },
            { kind: "agent.prompt", on_fail: { kind: "stop" }, prompt: "go" },
          ],
        },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(parsed.agents[0]!.steps[0]).toMatchObject({ kind: "agent.config", model: "opus" });
    expect(serializeWorkflowDefinition(parsed)).toEqual(wire);
  });

  it("round-trips a namespace-level integrations grant (E3)", () => {
    const wire = {
      version: 1,
      inputs: [],
      integrations: ["issues", "slack"],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.prompt", on_fail: { kind: "stop" }, prompt: "go" }],
        },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(parsed.integrations).toEqual(wire.integrations);
    expect(serializeWorkflowDefinition(parsed)).toEqual(wire);

    // Absent on the wire -> empty on the model -> empty array on serialize
    // (integrations is always present in v2, defaulting to []).
    const noIntegrations = parseWorkflowDefinition({ ...wire, integrations: undefined });
    expect(noIntegrations.integrations).toEqual([]);
  });
});

describe("editor multi-agent round-trip (track 1a′ battery line 1)", () => {
  it("builds a valid v2 definition from multi-agent editor state and round-trips it", () => {
    // Shape an editor would author: agents as top-level rail items, each with
    // its own harness/model and nested steps.
    const definition: WorkflowDefinition = {
      version: 1,
      name: "Triage and fix",
      description: "Files a triage note then attempts a fix on a second agent.",
      inputs: [{ name: "repo", type: "text", required: true }],
      integrations: ["issues"],
      agents: [
        {
          slot: "triage",
          harness: "claude",
          model: "sonnet",
          steps: [
            { kind: "agent.emit", onFail: { kind: "stop" }, prompt: "summarize {{inputs.repo}}", name: "summary" },
          ],
        },
        {
          slot: "fixer",
          harness: "codex",
          model: "gpt-5",
          steps: [
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "fix based on {{summary.text}}" },
            { kind: "shell.run", onFail: { kind: "retry", n: 1 }, command: "make test" },
          ],
        },
      ],
    };

    expect(validateWorkflowDefinition(definition)).toEqual([]);

    const wire = serializeWorkflowDefinition(definition);
    expect(wire.agents).toHaveLength(2);
    expect((wire.agents as { slot: string }[]).map((a) => a.slot)).toEqual(["triage", "fixer"]);

    const reparsed = parseWorkflowDefinition(wire);
    expect(reparsed).toEqual(definition);
    expect(validateWorkflowDefinition(reparsed)).toEqual([]);
  });

  it("flags a duplicate agent slot across top-level rail items", () => {
    const definition: WorkflowDefinition = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        { slot: "main", harness: "claude", model: "sonnet", steps: [] },
        { slot: "main", harness: "codex", model: "gpt-5", steps: [] },
      ],
    };
    const issues = validateWorkflowDefinition(definition);
    expect(issues.some((issue) => issue.code === "duplicate_slot")).toBe(true);
  });
});

describe("validation", () => {
  const base: WorkflowDefinition = {
    version: 1,
    inputs: [],
    integrations: [],
    agents: [
      {
        slot: "main",
        harness: "claude",
        model: "sonnet",
        steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "do it" }],
      },
    ],
  };

  it("accepts a valid definition", () => {
    expect(validateWorkflowDefinition(base)).toEqual([]);
  });

  it("flags empty prompt, missing agent config, and bad refs", () => {
    const bad: WorkflowDefinition = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "main",
          harness: "",
          model: "",
          steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "{{inputs.nope}}" }],
        },
      ],
    };
    const codes = validateWorkflowDefinition(bad).map((i) => i.code);
    expect(codes).toContain("invalid_definition");
    expect(codes).toContain("unknown_input_reference");
  });

  it("requires a model on an agent.config step", () => {
    const empty: WorkflowDefinition = {
      ...base,
      agents: [{ ...base.agents[0]!, steps: [{ kind: "agent.config", onFail: { kind: "stop" }, model: "" }] }],
    };
    expect(validateWorkflowDefinition(empty).map((i) => i.code)).toContain("invalid_definition");
    const ok: WorkflowDefinition = {
      ...base,
      agents: [
        {
          ...base.agents[0]!,
          steps: [
            { kind: "agent.config", onFail: { kind: "stop" }, model: "opus" },
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "go" },
          ],
        },
      ],
    };
    expect(validateWorkflowDefinition(ok)).toEqual([]);
  });

  it("flags a goal on a harness that doesn't support goals", () => {
    const codes = validateWorkflowDefinition(
      {
        ...base,
        agents: [
          {
            slot: "main",
            harness: "no-goals",
            model: "sonnet",
            steps: [
              {
                kind: "agent.prompt",
                onFail: { kind: "stop" },
                prompt: "go",
                goal: { objective: "x", maxTurns: 5, maxWallSecs: 60, onBlocked: "notify" },
              },
            ],
          },
        ],
      },
      { harnessSupportsGoals: (h) => h !== "no-goals" },
    ).map((i) => i.code);
    expect(codes).toContain("goal_unsupported_harness");
  });

  it("requires goal caps and objective when a goal is attached", () => {
    const withGoal: WorkflowDefinition = {
      ...base,
      agents: [
        {
          ...base.agents[0]!,
          steps: [
            {
              kind: "agent.prompt",
              onFail: { kind: "stop" },
              prompt: "go",
              goal: { objective: "", maxTurns: 0, maxWallSecs: 0, onBlocked: "notify" },
            },
          ],
        },
      ],
    };
    const codes = validateWorkflowDefinition(withGoal).map((i) => i.code);
    expect(codes.filter((c) => c === "invalid_definition").length).toBeGreaterThanOrEqual(3);
  });

  it("flags a branch that switches on a forward emit reference", () => {
    const bad: WorkflowDefinition = {
      ...base,
      agents: [
        {
          ...base.agents[0]!,
          steps: [
            {
              kind: "branch",
              onFail: { kind: "stop" },
              on: "{{verdict.field}}",
              cases: { yes: { to: "continue" } },
            },
          ],
        },
      ],
    };
    const codes = validateWorkflowDefinition(bad).map((i) => i.code);
    expect(codes).toContain("forward_emit_reference");
  });
});

describe("templates", () => {
  it("are all valid definitions", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(validateWorkflowDefinition(template.definition)).toEqual([]);
    }
  });

  it("survive a parse/serialize round-trip", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const round = parseWorkflowDefinition(serializeWorkflowDefinition(template.definition));
      expect(round).toEqual(template.definition);
    }
  });
});

describe("run-status derivation", () => {
  const definition = WORKFLOW_TEMPLATES[0]!.definition; // shell -> goal prompt -> pr

  it("marks earlier steps complete, the cursor goal-iterating, later pending", () => {
    const views = deriveStepRunViews({
      definition,
      runStatus: "running",
      stepCursor: 1,
    });
    expect(views.map((v) => v.status)).toEqual(["completed", "goal_iterating", "pending"]);
  });

  it("resolves every step on completion", () => {
    const views = deriveStepRunViews({ definition, runStatus: "completed", stepCursor: null });
    expect(views.every((v) => v.status === "completed")).toBe(true);
  });

  it("skips later steps on failure and reads typed chips", () => {
    const views = deriveStepRunViews({
      definition,
      runStatus: "failed",
      stepCursor: 0,
      stepOutputs: { "0.-.0": { exit_code: 1 } },
    });
    expect(views.map((v) => v.status)).toEqual(["failed", "skipped", "skipped"]);
    expect(views[0]!.chips).toEqual([{ kind: "exit", label: "exit 1", ok: false }]);
  });

  // Track 1a phase 2: a 2-agent sequential fixture (flattenWorkflowSteps
  // concatenates agent nodes in order — L30's per-lane cursor is a later
  // track), exercising per-slot session links and an unrecognized run
  // status (1c's `missed` / billing's `budget_blocked` landing ahead of a
  // client build that doesn't know them yet).
  const multiAgent: WorkflowDefinition = {
    version: 1,
    name: "Two-agent handoff",
    inputs: [],
    integrations: [],
    agents: [
      {
        slot: "triage",
        harness: "claude",
        model: "sonnet",
        steps: [
          {
            kind: "agent.emit",
            onFail: { kind: "stop" },
            prompt: "Summarize the incoming issue.",
            name: "triage_summary",
          },
        ],
      },
      {
        slot: "fixer",
        harness: "claude",
        model: "sonnet",
        steps: [
          {
            kind: "shell.run",
            onFail: { kind: "stop" },
            command: "make fix",
          },
          {
            kind: "scm.open_pr",
            onFail: { kind: "stop" },
            title: "fix: apply triage recommendation",
          },
        ],
      },
    ],
  };

  it("flattens multiple agent nodes into one ordered timeline, keyed by nodeIndex.-.stepIndex", () => {
    const views = deriveStepRunViews({
      definition: multiAgent,
      runStatus: "running",
      stepCursor: 2,
      stepOutputs: {
        "0.-.0": { session_id: "sess-triage", workspace_id: "ws-triage" },
        "1.-.0": { exit_code: 0 },
        "1.-.1": { session_id: "sess-fixer" },
      },
    });
    expect(views.map((v) => v.status)).toEqual(["completed", "completed", "running"]);
    // Step 0 belongs to the "triage" agent node; its own session link is
    // read from that step's own output, distinct from the "fixer" node's
    // session on step 2 (spec: session links per agent slot).
    expect(views[0]!.sessionLink).toEqual({ sessionId: "sess-triage", workspaceId: "ws-triage" });
    expect(views[2]!.sessionLink).toEqual({ sessionId: "sess-fixer", workspaceId: null });
    expect(views[1]!.chips).toEqual([{ kind: "exit", label: "exit 0", ok: true }]);
  });

  it("renders an unrecognized run status gracefully instead of a false running/skipped state", () => {
    // coerceRunStatus (called upstream by the run view) would map an
    // unmodeled wire status like "budget_blocked" to "unknown" before this
    // reaches deriveStepRunViews.
    const views = deriveStepRunViews({
      definition: multiAgent,
      runStatus: "unknown",
      stepCursor: 1,
    });
    expect(views.map((v) => v.status)).toEqual(["completed", "blocked", "pending"]);
    // Later steps stay "pending" (not "skipped"): an unrecognized status
    // might still resume, unlike a genuine terminal failure.
    expect(views[2]!.status).toBe("pending");
  });
});

describe("run-status: unrecognized wire status (future-status readiness)", () => {
  it("coerces to unknown instead of a false running", () => {
    // budget_blocked is an error_code on a failed run, never a status; a truly
    // novel wire status must land on the unknown sentinel. `missed` became a
    // first-class status in 1c and now round-trips.
    expect(coerceRunStatus("budget_blocked")).toBe("unknown");
    expect(coerceRunStatus("missed")).toBe("missed");
    expect(coerceRunStatus("running")).toBe("running");
  });

  it("humanizes the raw value for the label and flags it as attention-toned", () => {
    const status = coerceRunStatus("budget_blocked");
    expect(workflowRunStatusLabel(status, "budget_blocked")).toBe("Budget blocked");
    expect(workflowRunStatusTone(status)).toBe("attention");
  });

  it("falls back to a generic label when there is no usable raw value", () => {
    expect(workflowRunStatusLabel("unknown")).toBe("Unknown");
    expect(workflowRunStatusLabel("unknown", 42)).toBe("Unknown");
  });
});

// 1c: scheduling UX — missed-run history rows + the budget_blocked deny-path
// (D-002) read as distinct, quiet statuses through the same chip atoms.
describe("run status presentation — missed + budget_blocked (1c)", () => {
  it("labels a missed run quietly and treats it as terminal, not a failure", () => {
    expect(workflowRunStatusLabel("missed")).toBe("Missed");
    expect(workflowRunStatusTone("missed")).toBe("muted");
    expect(isTerminalRunStatus("missed")).toBe(true);
    expect(workflowRunStatusDetail("missed")).toMatch(/wasn't run/);
  });

  it("labels a budget_blocked failure distinctly from a generic failure, same tone", () => {
    expect(workflowRunStatusLabel("failed", "budget_blocked")).toBe("Over budget");
    expect(workflowRunStatusLabel("failed", "some_other_code")).toBe("Failed");
    expect(workflowRunStatusLabel("failed")).toBe("Failed");
    expect(workflowRunStatusTone("failed")).toBe("danger");
    expect(workflowRunStatusDetail("failed", "budget_blocked")).toMatch(/usage budget/);
    expect(workflowRunStatusDetail("failed")).toBeNull();
  });

  it("leaves every other status's label/detail unaffected by a stray errorCode", () => {
    expect(workflowRunStatusLabel("completed", "budget_blocked")).toBe("Completed");
    expect(workflowRunStatusDetail("completed")).toBeNull();
  });
});

describe("buildWorkflowRunRow — missed + budget_blocked round-trip (1c)", () => {
  const base = {
    id: "run-1",
    workflowId: "wf-1",
    workflowName: "Triage new Sentry issues",
    triggerKind: "schedule",
    startedAt: null,
    finishedAt: "2026-07-09T00:00:00Z",
    costUsd: null,
    costTokens: null,
  };

  it("surfaces a budget_blocked run as 'Over budget', danger tone, with a detail tooltip", () => {
    const row = buildWorkflowRunRow({ ...base, status: "failed", errorCode: "budget_blocked" });
    expect(row.statusLabel).toBe("Over budget");
    expect(row.statusTone).toBe("danger");
    expect(row.statusDetail).toMatch(/usage budget/);
  });

  it("surfaces a missed run as 'Missed', muted tone, no error banner", () => {
    const row = buildWorkflowRunRow({ ...base, status: "missed", errorCode: null });
    expect(row.statusLabel).toBe("Missed");
    expect(row.statusTone).toBe("muted");
    expect(row.statusDetail).toMatch(/wasn't run/);
  });

  it("leaves a plain failure as the generic 'Failed' label", () => {
    const row = buildWorkflowRunRow({ ...base, status: "failed", errorCode: null });
    expect(row.statusLabel).toBe("Failed");
    expect(row.statusDetail).toBeNull();
  });
});

describe("presentation", () => {
  it("uses the goal glyph for goal-armed prompts", () => {
    const strip = workflowStepStrip(WORKFLOW_TEMPLATES[0]!.definition);
    expect(strip).toEqual(["$", "◎", "⇈"]);
  });

  it("renders the two-line goal rail treatment", () => {
    const line = goalRailLine(WORKFLOW_TEMPLATES[0]!.definition.agents[0]!.steps[1]!);
    expect(line?.glyph).toBe("◎");
    expect(line?.text).toContain("25t · 90m · 400k");
  });
});

describe("effective-config derivation", () => {
  it("single agent, no config steps: all steps share scope 0, first step opens the session", () => {
    const def: WorkflowDefinition = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "hello" },
            { kind: "shell.run", onFail: { kind: "stop" }, command: "make test" },
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "done" },
          ],
        },
      ],
    };
    const configs = deriveEffectiveConfigs(def);
    expect(configs).toHaveLength(3);
    expect(configs[0]).toMatchObject({
      effectiveHarness: "claude",
      effectiveModel: "sonnet",
      isNewSession: true,
      scopeIndex: 0,
    });
    expect(configs[1]).toMatchObject({ isNewSession: false, scopeIndex: 0 });
    expect(configs[2]).toMatchObject({ isNewSession: false, scopeIndex: 0 });
  });

  it("agent.config model switch: same session (harness never changes mid-slot)", () => {
    const def: WorkflowDefinition = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "start" },
            { kind: "agent.config", onFail: { kind: "stop" }, model: "opus" },
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "continue" },
          ],
        },
      ],
    };
    const configs = deriveEffectiveConfigs(def);
    expect(configs[0]).toMatchObject({ isNewSession: true, scopeIndex: 0 });
    expect(configs[1]).toMatchObject({
      effectiveHarness: "claude",
      effectiveModel: "opus",
      isNewSession: false,
      scopeIndex: 0,
    });
    expect(configs[2]).toMatchObject({ effectiveModel: "opus", isNewSession: false, scopeIndex: 0 });
  });

  it("a second agent node (different slot) opens a new session/scope", () => {
    const def: WorkflowDefinition = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "triage",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "start" }],
        },
        {
          slot: "fix",
          harness: "codex",
          model: "gpt",
          steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "in codex" }],
        },
      ],
    };
    const configs = deriveEffectiveConfigs(def);
    expect(configs[0]).toMatchObject({ effectiveHarness: "claude", isNewSession: true, scopeIndex: 0 });
    expect(configs[1]).toMatchObject({ effectiveHarness: "codex", effectiveModel: "gpt", isNewSession: true, scopeIndex: 1 });
  });

  it("scope groups derive correctly across two agent nodes", () => {
    const def: WorkflowDefinition = {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [
            { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "a" },
            { kind: "shell.run", onFail: { kind: "stop" }, command: "test" },
          ],
        },
        {
          slot: "fix",
          harness: "codex",
          model: "gpt",
          steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "b" }],
        },
      ],
    };
    const configs = deriveEffectiveConfigs(def);
    const groups = deriveScopeGroups(configs);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ startIndex: 0, endIndex: 1, scopeIndex: 0, harness: "claude" });
    expect(groups[1]).toMatchObject({ startIndex: 2, endIndex: 2, scopeIndex: 1, harness: "codex" });
  });
});
