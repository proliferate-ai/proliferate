import { describe, expect, it } from "vitest";

import {
  flattenWorkflowSteps,
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
  deriveRunTimeline,
  deriveStepRunViews,
  isTerminalRunStatus,
  shouldPollRun,
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

  it("round-trips per-slot integration narrowing (track 3c phase 2)", () => {
    const wire = {
      version: 1,
      inputs: [],
      integrations: ["issues", "slack"],
      agents: [
        {
          slot: "triage",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.prompt", on_fail: { kind: "stop" }, prompt: "go" }],
          integrations: ["issues"],
        },
        {
          slot: "fix",
          harness: "claude",
          model: "opus",
          steps: [{ kind: "agent.prompt", on_fail: { kind: "stop" }, prompt: "go" }],
        },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(parsed.agents[0]!.integrations).toEqual(["issues"]);
    // Absence, not just falsy-ness — the unnarrowed slot never gets the key.
    expect(parsed.agents[1]!.integrations).toBeUndefined();
    expect(serializeWorkflowDefinition(parsed)).toEqual(wire);
  });

  it("distinguishes an explicit empty narrowing from an absent field", () => {
    const wire = {
      version: 1,
      inputs: [],
      integrations: ["issues"],
      agents: [
        {
          slot: "quiet",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.prompt", on_fail: { kind: "stop" }, prompt: "go" }],
          integrations: [],
        },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(parsed.agents[0]!.integrations).toEqual([]);
    expect(serializeWorkflowDefinition(parsed)).toEqual(wire);
  });

  it("flags a present-but-non-array agent integrations as invalid (not silently absent)", () => {
    // Parse preserves the bad shape verbatim (not treated as absent) so the
    // validator surfaces `invalid_definition`, matching the server's parse.
    const wire = {
      version: 1,
      inputs: [],
      integrations: ["issues"],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.prompt", on_fail: { kind: "stop" }, prompt: "go" }],
          integrations: "issues",
        },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    expect(Array.isArray(parsed.agents[0]!.integrations)).toBe(false);
    const codes = validateWorkflowDefinition(parsed).map((i) => i.code);
    expect(codes).toContain("invalid_definition");
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

describe("parallel groups (L30 / D-031)", () => {
  function parallelDefinition(): WorkflowDefinition {
    return {
      version: 1,
      inputs: [{ name: "issue", type: "text", required: true }],
      integrations: [],
      agents: [
        {
          slot: "plan",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.emit", onFail: { kind: "stop" }, name: "spec", prompt: "{{inputs.issue}}" }],
        },
        {
          parallel: [
            {
              slot: "fix_a",
              harness: "claude",
              model: "sonnet",
              steps: [
                { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "impl {{spec.summary}}" },
                { kind: "agent.emit", onFail: { kind: "stop" }, name: "result_a", prompt: "report" },
              ],
            },
            {
              slot: "fix_b",
              harness: "codex",
              model: "gpt-5",
              steps: [{ kind: "shell.run", onFail: { kind: "stop" }, command: "make test" }],
            },
          ],
        },
        {
          slot: "merge",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "notify", onFail: { kind: "stop" }, slackChannelId: "C1", message: "{{result_a.ok}}" }],
        },
      ],
    };
  }

  it("round-trips a parallel-group wire dict and flattens lane-qualified keys", () => {
    const definition = parallelDefinition();
    expect(validateWorkflowDefinition(definition)).toEqual([]);

    const wire = serializeWorkflowDefinition(definition);
    expect((wire.agents as Record<string, unknown>[])[1]).toEqual({
      parallel: [
        expect.objectContaining({ slot: "fix_a" }),
        expect.objectContaining({ slot: "fix_b" }),
      ],
    });
    const reparsed = parseWorkflowDefinition(wire);
    expect(reparsed).toEqual(definition);

    // Flatten mirrors the server resolver: standalone "-" lane, group lanes keyed
    // by slot, lane-grouped in lane order.
    expect(flattenWorkflowSteps(definition).map((f) => f.stepKey)).toEqual([
      "0.-.0",
      "1.fix_a.0",
      "1.fix_a.1",
      "1.fix_b.0",
      "2.-.0",
    ]);
  });

  it("rejects a sibling-lane emit reference (deny path)", () => {
    const definition = parallelDefinition();
    const group = definition.agents[1] as { parallel: { steps: unknown[] }[] };
    group.parallel[1]!.steps[0] = {
      kind: "agent.prompt",
      onFail: { kind: "stop" },
      prompt: "use {{result_a.ok}}",
    };
    const codes = validateWorkflowDefinition(definition).map((i) => i.code);
    expect(codes).toContain("forward_emit_reference");
  });

  it("accepts a lane referencing a prior spine emit, and post-group refs to any lane", () => {
    // The baseline exercises both (fix_a reads `spec`; merge reads `result_a`).
    expect(validateWorkflowDefinition(parallelDefinition())).toEqual([]);
  });

  it("flags a single-node parallel group", () => {
    const definition = parallelDefinition();
    (definition.agents[1] as { parallel: unknown[] }).parallel.pop();
    expect(validateWorkflowDefinition(definition).map((i) => i.code)).toContain("parallel_too_few");
  });

  it("flags a duplicate emit across lanes and a duplicate slot across lane+node", () => {
    const dupEmit = parallelDefinition();
    (dupEmit.agents[1] as { parallel: { steps: unknown[] }[] }).parallel[1]!.steps[0] = {
      kind: "agent.emit",
      onFail: { kind: "stop" },
      name: "result_a",
      prompt: "x",
    };
    expect(validateWorkflowDefinition(dupEmit).map((i) => i.code)).toContain("duplicate_emit");

    const dupSlot = parallelDefinition();
    (dupSlot.agents[1] as { parallel: { slot: string }[] }).parallel[0]!.slot = "plan";
    expect(validateWorkflowDefinition(dupSlot).map((i) => i.code)).toContain("duplicate_slot");
  });

  it("flags workflow.include inside a parallel lane", () => {
    const definition = parallelDefinition();
    (definition.agents[1] as { parallel: { steps: unknown[] }[] }).parallel[0]!.steps = [
      { kind: "workflow.include", onFail: { kind: "stop" }, workflowId: "wf", args: {} },
    ];
    expect(validateWorkflowDefinition(definition).map((i) => i.code)).toContain("include_in_parallel");
  });

  it("flags a notify agentFields.slot that is not the enclosing lane's own slot", () => {
    // STEP 0 lane-scope ruling: inside a lane, the fields emit runs in that lane's
    // worktree, so agentFields.slot must be the lane's OWN slot — a sibling's is
    // rejected (agent_fields_slot_outside_lane), even though it's a real slot.
    const definition = parallelDefinition();
    (definition.agents[1] as { parallel: { steps: unknown[] }[] }).parallel[0]!.steps.push({
      kind: "notify",
      onFail: { kind: "stop" },
      slackChannelId: "C1",
      message: "status {{fields.summary}}",
      agentFields: { slot: "fix_b", schema: { summary: { type: "string" } } },
    });
    expect(validateWorkflowDefinition(definition).map((i) => i.code)).toContain(
      "agent_fields_slot_outside_lane",
    );
  });

  it("accepts a notify agentFields.slot that is the enclosing lane's own slot", () => {
    const definition = parallelDefinition();
    (definition.agents[1] as { parallel: { steps: unknown[] }[] }).parallel[0]!.steps.push({
      kind: "notify",
      onFail: { kind: "stop" },
      slackChannelId: "C1",
      message: "status {{fields.summary}}",
      agentFields: { slot: "fix_a", schema: { summary: { type: "string" } } },
    });
    expect(validateWorkflowDefinition(definition)).toEqual([]);
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

  describe("per-slot integration narrowing (track 3c phase 2)", () => {
    const withIntegrations: WorkflowDefinition = {
      ...base,
      integrations: ["issues", "slack"],
    };

    it("accepts a subset narrowing", () => {
      const ok: WorkflowDefinition = {
        ...withIntegrations,
        agents: [{ ...withIntegrations.agents[0]!, integrations: ["issues"] }],
      };
      expect(validateWorkflowDefinition(ok)).toEqual([]);
    });

    it("accepts an explicit empty narrowing (deny-path b: excludes everything)", () => {
      const ok: WorkflowDefinition = {
        ...withIntegrations,
        agents: [{ ...withIntegrations.agents[0]!, integrations: [] }],
      };
      expect(validateWorkflowDefinition(ok)).toEqual([]);
    });

    it("leaves an unnarrowed slot unchanged (deny-path c: no issue, no field)", () => {
      const ok: WorkflowDefinition = withIntegrations;
      expect(validateWorkflowDefinition(ok)).toEqual([]);
      expect(ok.agents[0]!.integrations).toBeUndefined();
    });

    it("flags a namespace not in the workflow-level list (deny-path a)", () => {
      const bad: WorkflowDefinition = {
        ...withIntegrations,
        agents: [{ ...withIntegrations.agents[0]!, integrations: ["issues", "context7"] }],
      };
      const codes = validateWorkflowDefinition(bad).map((i) => i.code);
      expect(codes).toContain("agent_integrations_not_subset");
    });

    it("flags a duplicate namespace on the same agent", () => {
      const bad: WorkflowDefinition = {
        ...withIntegrations,
        agents: [{ ...withIntegrations.agents[0]!, integrations: ["issues", "issues"] }],
      };
      const codes = validateWorkflowDefinition(bad).map((i) => i.code);
      expect(codes).toContain("duplicate_integration");
    });
  });
});

describe("notify agent-filled fields (track 3c)", () => {
  const withNotifyFields = (
    overrides: Partial<{ message: string; slot: string }> = {},
  ): WorkflowDefinition => ({
    version: 1,
    inputs: [],
    integrations: [],
    agents: [
      {
        slot: "main",
        harness: "claude",
        model: "sonnet",
        steps: [
          {
            kind: "notify",
            onFail: { kind: "stop" },
            slackChannelId: "C1",
            message: overrides.message ?? "done: {{fields.summary}}",
            agentFields: {
              slot: overrides.slot ?? "main",
              schema: {
                summary: { type: "string", description: "one-liner" },
                risk: { type: "number" },
              },
            },
          },
        ],
      },
    ],
  });

  it("accepts a notify whose message references declared agent fields", () => {
    expect(validateWorkflowDefinition(withNotifyFields())).toEqual([]);
  });

  it("flags {{fields.*}} in a notify with no agent_fields (deny-path a)", () => {
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
            {
              kind: "notify",
              onFail: { kind: "stop" },
              slackChannelId: "C1",
              message: "value: {{fields.summary}}",
            },
          ],
        },
      ],
    };
    expect(validateWorkflowDefinition(def).map((i) => i.code)).toContain(
      "fields_reference_not_allowed",
    );
  });

  it("flags a fields ref not present in the schema (deny-path b)", () => {
    const codes = validateWorkflowDefinition(
      withNotifyFields({ message: "value: {{fields.ghost}}" }),
    ).map((i) => i.code);
    expect(codes).toContain("unknown_field_reference");
  });

  it("flags {{fields.*}} outside a notify message", () => {
    const codes = validateWorkflowDefinition({
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "use {{fields.x}}" }],
        },
      ],
    }).map((i) => i.code);
    expect(codes).toContain("fields_reference_not_allowed");
  });

  it("flags an agent-fields slot that is not an agent", () => {
    const codes = validateWorkflowDefinition(withNotifyFields({ slot: "ghost" })).map((i) => i.code);
    expect(codes).toContain("unknown_slot");
  });

  it("flags a schema field with an unrecognized type (not silently dropped)", () => {
    // Parse preserves the bad type so the validator can flag it, rather than
    // dropping the field before the type check runs (matches the server's parse).
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
            {
              kind: "notify",
              on_fail: { kind: "stop" },
              slack_channel_id: "C1",
              message: "done: {{fields.summary}}",
              agent_fields: {
                slot: "main",
                schema: { summary: { type: "date" } },
              },
            },
          ],
        },
      ],
    };
    const parsed = parseWorkflowDefinition(wire);
    // The field survives parse (with its raw, invalid type) so validation sees it.
    const notify = parsed.agents[0]!.steps[0]!;
    expect(notify.kind === "notify" && notify.agentFields?.schema.summary).toBeTruthy();
    const codes = validateWorkflowDefinition(parsed).map((i) => i.code);
    expect(codes).toContain("invalid_definition");
  });

  it("rejects an emit named with the reserved notify-fields prefix (deny-path c)", () => {
    const codes = validateWorkflowDefinition({
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "main",
          harness: "claude",
          model: "sonnet",
          steps: [
            { kind: "agent.emit", onFail: { kind: "stop" }, prompt: "go", name: "__notify_fields_0" },
          ],
        },
      ],
    }).map((i) => i.code);
    expect(codes).toContain("invalid_definition");
  });

  it("round-trips agent_fields through parse/serialize", () => {
    const def = withNotifyFields();
    const wire = serializeWorkflowDefinition(def);
    const notifyWire = (wire.agents as { steps: Record<string, unknown>[] }[])[0]!.steps[0]!;
    expect(notifyWire.agent_fields).toEqual({
      slot: "main",
      schema: {
        summary: { type: "string", description: "one-liner" },
        risk: { type: "number" },
      },
    });
    const reparsed = parseWorkflowDefinition(wire);
    expect(serializeWorkflowDefinition(reparsed)).toEqual(wire);
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

// Track 3a phase 3: the two-dimensional (lane-aware) run timeline. The
// engine pins the run's single global `stepCursor` at a parallel group's
// start for the group's whole lifetime (arch §3.1), so per-lane progress
// inside an active/failed group must be derived independently — this is
// what `deriveRunTimeline` adds on top of `deriveStepRunViews`.
describe("run-status: two-dimensional lane timeline (deriveRunTimeline)", () => {
  function lanedDefinition(): WorkflowDefinition {
    return {
      version: 1,
      inputs: [],
      integrations: [],
      agents: [
        {
          slot: "plan",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "agent.emit", onFail: { kind: "stop" }, name: "spec", prompt: "go" }],
        },
        {
          parallel: [
            {
              slot: "fix_a",
              harness: "claude",
              model: "sonnet",
              steps: [
                { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "impl a" },
                { kind: "agent.emit", onFail: { kind: "stop" }, name: "result_a", prompt: "report" },
              ],
            },
            {
              slot: "fix_b",
              harness: "codex",
              model: "gpt-5",
              steps: [{ kind: "shell.run", onFail: { kind: "stop" }, command: "make test" }],
            },
          ],
        },
        {
          slot: "merge",
          harness: "claude",
          model: "sonnet",
          steps: [{ kind: "notify", onFail: { kind: "stop" }, slackChannelId: "C1", message: "done" }],
        },
      ],
    };
  }

  it("a flat definition (no parallel groups) is one sequential segment, byte-identical to deriveStepRunViews", () => {
    const definition = WORKFLOW_TEMPLATES[0]!.definition;
    const input = { definition, runStatus: "running" as const, stepCursor: 1 };
    expect(deriveRunTimeline(input)).toEqual([{ kind: "sequential", steps: deriveStepRunViews(input) }]);
  });

  it("a group not yet reached renders every lane pending, matching the pre-group sequential prefix", () => {
    const definition = lanedDefinition();
    const segments = deriveRunTimeline({ definition, runStatus: "running", stepCursor: 0 });
    expect(segments[0]).toEqual({ kind: "sequential", steps: [expect.objectContaining({ status: "running" })] });
    const group = segments[1] as { kind: "parallel"; lanes: { lane: string; status: string; steps: { status: string }[] }[] };
    expect(group.kind).toBe("parallel");
    expect(group.lanes.map((l) => l.status)).toEqual(["pending", "pending"]);
    expect(group.lanes.every((l) => l.steps.every((s) => s.status === "pending"))).toBe(true);
  });

  it("an active group derives each lane's live step independently, ahead-sibling included", () => {
    const definition = lanedDefinition();
    const segments = deriveRunTimeline({
      definition,
      runStatus: "running",
      stepCursor: 1, // pinned at the group's start the whole time it's active
      stepOutputs: {
        "1.fix_a.0": { ok: true },
        "1.fix_a.1": { ok: true }, // fix_a finished both its steps already
        // fix_b has no output yet — it's the live lane
      },
    });
    const group = segments[1] as {
      kind: "parallel";
      lanes: { lane: string; status: string; steps: { status: string }[] }[];
    };
    const fixA = group.lanes.find((l) => l.lane === "fix_a")!;
    const fixB = group.lanes.find((l) => l.lane === "fix_b")!;
    expect(fixA.status).toBe("completed");
    expect(fixA.steps.map((s) => s.status)).toEqual(["completed", "completed"]);
    expect(fixB.status).toBe("running");
    expect(fixB.steps.map((s) => s.status)).toEqual(["running"]);
  });

  it("a failed join renders the failed lane honestly alongside a sibling that ran to completion", () => {
    const definition = lanedDefinition();
    const segments = deriveRunTimeline({
      definition,
      runStatus: "failed",
      stepCursor: 1, // the engine never advances the cursor past a failed group
      stepOutputs: {
        "1.fix_a.0": { ok: true },
        "1.fix_a.1": { ok: true },
        // fix_b never produced an output — it's the lane that failed
      },
    });
    const group = segments[1] as {
      kind: "parallel";
      lanes: { lane: string; status: string; steps: { status: string }[] }[];
    };
    const fixA = group.lanes.find((l) => l.lane === "fix_a")!;
    const fixB = group.lanes.find((l) => l.lane === "fix_b")!;
    expect(fixA.status).toBe("completed");
    expect(fixB.status).toBe("failed");
    expect(fixB.steps.map((s) => s.status)).toEqual(["failed"]);
    // Steps after the group never ran — the join fails the run (D-031b).
    const post = segments[2] as { kind: "sequential"; steps: { status: string }[] };
    expect(post.steps.map((s) => s.status)).toEqual(["skipped"]);
  });

  it("a completed run renders every lane and the post-group step completed", () => {
    const definition = lanedDefinition();
    const segments = deriveRunTimeline({ definition, runStatus: "completed", stepCursor: null });
    const group = segments[1] as { kind: "parallel"; lanes: { status: string }[] };
    expect(group.lanes.every((l) => l.status === "completed")).toBe(true);
    const post = segments[2] as { kind: "sequential"; steps: { status: string }[] };
    expect(post.steps.map((s) => s.status)).toEqual(["completed"]);
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

// 2a: the desktop-executor lane adds two waiting statuses a local scheduled run
// occupies before its relay reports `running`. They must be first-class client
// statuses — non-terminal (keep polling), quietly labelled, never coerced to the
// terminal `unknown` sentinel (which would stop polling + render attention).
describe("run status presentation — desktop claim lane (2a: claimable + claimed)", () => {
  it("round-trips both statuses over the wire instead of coercing to unknown", () => {
    expect(coerceRunStatus("claimable")).toBe("claimable");
    expect(coerceRunStatus("claimed")).toBe("claimed");
  });

  it("treats both as NON-terminal so the run view keeps polling a waiting run", () => {
    expect(isTerminalRunStatus("claimable")).toBe(false);
    expect(isTerminalRunStatus("claimed")).toBe(false);
    expect(shouldPollRun("claimable")).toBe(true);
    expect(shouldPollRun("claimed")).toBe(true);
  });

  it("labels them quietly with running-adjacent (not attention/danger) tones", () => {
    expect(workflowRunStatusLabel("claimable")).toBe("Waiting for device");
    expect(workflowRunStatusLabel("claimed")).toBe("Starting on device");
    expect(workflowRunStatusTone("claimable")).toBe("muted");
    expect(workflowRunStatusTone("claimed")).toBe("running");
    expect(workflowRunStatusDetail("claimable")).toMatch(/waiting for a signed-in device/i);
    expect(workflowRunStatusDetail("claimed")).toMatch(/claimed this run/i);
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
