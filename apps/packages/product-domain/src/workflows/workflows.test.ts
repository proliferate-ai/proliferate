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
import { deriveStepRunViews } from "./run-status";
import { WORKFLOW_TEMPLATES } from "./templates";
import { goalRailLine, workflowStepStrip } from "./presentation";

describe("interpolation", () => {
  it("parses arg and step-output references", () => {
    const refs = iterReferences("fix {{args.repo}} using {{steps[0].output.diff}}");
    expect(refs).toEqual([
      { kind: "arg", name: "repo" },
      { kind: "stepOutput", index: 0, name: "diff" },
    ]);
  });

  it("flags unknown args and forward step references", () => {
    const argNames = new Set(["repo"]);
    expect(
      validateStringReferences("{{args.missing}}", { argNames, stepIndex: 1 }).map((i) => i.code),
    ).toEqual(["unknown_arg_reference"]);
    expect(
      validateStringReferences("{{steps[2].output.x}}", { argNames, stepIndex: 1 }).map(
        (i) => i.code,
      ),
    ).toEqual(["forward_step_reference"]);
    expect(
      validateStringReferences("{{steps[0].output.x}}", { argNames, stepIndex: 1 }),
    ).toEqual([]);
  });

  it("rejects malformed placeholders and ignores escaped braces", () => {
    const argNames = new Set<string>();
    expect(
      validateStringReferences("{{ not a ref }}", { argNames, stepIndex: 0 }).map((i) => i.code),
    ).toEqual(["invalid_template_reference"]);
    expect(iterReferences("\\{{args.repo}}")).toEqual([]);
  });

  it("suggests only args and strictly-earlier step outputs", () => {
    const suggestions = templateSuggestions({
      args: [{ name: "repo", type: "string" }],
      stepIndex: 2,
      priorStepOutputs: [
        { index: 0, stepLabel: "Script", outputNames: ["diff"] },
        { index: 3, stepLabel: "Script", outputNames: ["late"] },
      ],
    });
    expect(suggestions.map((s) => s.token)).toEqual([
      "{{args.repo}}",
      "{{steps[0].output.diff}}",
    ]);
  });
});

describe("definition parse/serialize", () => {
  it("round-trips a canonical wire dict", () => {
    const wire = {
      args: [{ name: "repo", type: "string", required: true }],
      setup: { harness: "claude-code", model: "sonnet", session_binding: "headless" },
      steps: [
        {
          kind: "agent.prompt",
          on_fail: { kind: "retry", n: 2 },
          prompt: "fix {{args.repo}}",
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
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(parsed.setup.sessionBinding).toBe("headless");
    expect(parsed.steps[0]).toMatchObject({ kind: "agent.prompt", onFail: { kind: "retry", n: 2 } });
    expect(serializeWorkflowDefinition(parsed)).toEqual(wire);
  });

  it("round-trips an agent.config step", () => {
    const wire = {
      args: [],
      setup: { harness: "claude", model: "sonnet", session_binding: "fresh" },
      steps: [
        { kind: "agent.config", on_fail: { kind: "stop" }, harness: "codex", model: "opus" },
        { kind: "agent.config", on_fail: { kind: "stop" }, harness: "claude" },
        { kind: "agent.prompt", on_fail: { kind: "stop" }, prompt: "go" },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(parsed.steps[0]).toMatchObject({ kind: "agent.config", harness: "codex", model: "opus" });
    expect(parsed.steps[1]).toMatchObject({ kind: "agent.config", harness: "claude" });
    expect((parsed.steps[1] as { model?: string }).model).toBeUndefined();
    expect(serializeWorkflowDefinition(parsed)).toEqual(wire);
  });
});

describe("validation", () => {
  const base: WorkflowDefinition = {
    args: [],
    setup: { harness: "claude-code", model: "sonnet", sessionBinding: "fresh" },
    steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "do it" }],
  };

  it("accepts a valid definition", () => {
    expect(validateWorkflowDefinition(base)).toEqual([]);
  });

  it("flags empty prompt, missing setup, and bad refs", () => {
    const bad: WorkflowDefinition = {
      args: [],
      setup: { harness: "", model: "", sessionBinding: "fresh" },
      steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "{{args.nope}}" }],
    };
    const codes = validateWorkflowDefinition(bad).map((i) => i.code);
    expect(codes).toContain("invalid_definition");
    expect(codes).toContain("unknown_arg_reference");
  });

  it("requires at least one of harness/model on an agent.config step", () => {
    const empty: WorkflowDefinition = {
      ...base,
      steps: [{ kind: "agent.config", onFail: { kind: "stop" } }],
    };
    expect(validateWorkflowDefinition(empty).map((i) => i.code)).toContain("invalid_definition");
    const ok: WorkflowDefinition = {
      ...base,
      steps: [
        { kind: "agent.config", onFail: { kind: "stop" }, model: "opus" },
        { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "go" },
      ],
    };
    expect(validateWorkflowDefinition(ok)).toEqual([]);
  });

  it("folds agent.config harness for goal-capability checks", () => {
    const codes = validateWorkflowDefinition(
      {
        ...base,
        steps: [
          { kind: "agent.config", onFail: { kind: "stop" }, harness: "no-goals" },
          {
            kind: "agent.prompt",
            onFail: { kind: "stop" },
            prompt: "go",
            goal: { objective: "x", maxTurns: 5, maxWallSecs: 60, onBlocked: "notify" },
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
      steps: [
        {
          kind: "agent.prompt",
          onFail: { kind: "stop" },
          prompt: "go",
          goal: { objective: "", maxTurns: 0, maxWallSecs: 0, onBlocked: "notify" },
        },
      ],
    };
    const codes = validateWorkflowDefinition(withGoal).map((i) => i.code);
    expect(codes.filter((c) => c === "invalid_definition").length).toBeGreaterThanOrEqual(3);
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

  it("marks earlier steps complete, the cursor running, later pending", () => {
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
      stepOutputs: { "0": { exit_code: 1 } },
    });
    expect(views.map((v) => v.status)).toEqual(["failed", "skipped", "skipped"]);
    expect(views[0]!.chips).toEqual([{ kind: "exit", label: "exit 1", ok: false }]);
  });
});

describe("presentation", () => {
  it("uses the goal glyph for goal-armed prompts", () => {
    const strip = workflowStepStrip(WORKFLOW_TEMPLATES[0]!.definition);
    expect(strip).toEqual(["$", "◎", "⇈"]);
  });

  it("renders the two-line goal rail treatment", () => {
    const line = goalRailLine(WORKFLOW_TEMPLATES[0]!.definition.steps[1]!);
    expect(line?.glyph).toBe("◎");
    expect(line?.text).toContain("25t · 90m · 400k");
  });
});
