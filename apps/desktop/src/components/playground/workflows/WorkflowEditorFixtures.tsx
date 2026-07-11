import { useState, useMemo } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  flattenWorkflowSteps,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { deriveEffectiveConfigs } from "@proliferate/product-domain/workflows/effective-config";
import { WorkflowStepPanel, type EditorAgent } from "@/components/workflows/editor/WorkflowStepPanel";
import { WorkflowStepRailCard } from "@/components/workflows/editor/WorkflowStepRailCard";
import { WorkflowScopeHeader } from "@/components/workflows/editor/WorkflowScopeHeader";

const AGENTS: EditorAgent[] = [
  {
    kind: "claude",
    displayName: "Claude Code",
    models: [
      { id: "opus", label: "Opus 4.8" },
      { id: "sonnet", label: "Sonnet 4.6" },
    ],
  },
  { kind: "codex", displayName: "Codex", models: [{ id: "gpt", label: "GPT-5" }] },
  { kind: "opencode", displayName: "OpenCode", models: [{ id: "gpt-4o", label: "GPT-4o" }] },
];

const SUGGESTIONS: TemplateSuggestion[] = [
  { token: "{{inputs.pr_number}}", label: "inputs.pr_number", detail: "input · number", kind: "input" },
  { token: "{{verdict.field}}", label: "verdict.field", detail: "emit · Prompt output", kind: "emit" },
];

// --- Scope-demo rail: exercises all scope-boundary cases ---
// Node "main" (claude · sonnet) → INITIAL scope header (unnumbered)
//   Step 0: agent.prompt   → action 1
//   Step 1: shell.run      → action 2
//   Step 2: agent.config model-only → opus → MODEL-ONLY scope header (quiet, unnumbered)
//   Step 3: agent.prompt   → action 3
// Node "review" (opencode · gpt-4o) → NEW-SESSION scope header (emphasis, unnumbered)
//   Step 4: agent.prompt   → action 4

const SCOPE_DEMO_DEFINITION: WorkflowDefinition = {
  version: 1,
  inputs: [],
  integrations: [],
  agents: [
    {
      slot: "main",
      harness: "claude",
      model: "sonnet",
      steps: [
        { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "Analyze the codebase and identify all API endpoints that lack input validation." },
        { kind: "shell.run", onFail: { kind: "continue" }, command: "pnpm build && pnpm test" },
        { kind: "agent.config", onFail: { kind: "stop" }, model: "opus" },
        {
          kind: "agent.prompt",
          onFail: { kind: "stop" },
          prompt: "Based on the analysis, fix all validation gaps and add comprehensive test coverage.",
          goal: {
            objective: "all tests pass with full validation coverage",
            maxTurns: 25,
            maxWallSecs: 5400,
            tokenBudget: 400_000,
            onBlocked: "notify",
            verify: { shell: "pnpm test", expectExit: 0 },
          },
        },
      ],
    },
    {
      slot: "review",
      harness: "opencode",
      model: "gpt-4o",
      steps: [
        { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "Review the changes from a second perspective and suggest any improvements." },
      ],
    },
  ],
};

function resolveLabels(harnessKind: string, modelId: string) {
  const agent = AGENTS.find((a) => a.kind === harnessKind);
  return {
    harness: agent?.displayName ?? (harnessKind || "No agent"),
    model: agent?.models.find((m) => m.id === modelId)?.label ?? modelId ?? "",
  };
}

function ScopeDemoRail() {
  const [selected, setSelected] = useState<number>(0);
  const flatSteps = useMemo(() => flattenWorkflowSteps(SCOPE_DEMO_DEFINITION), []);
  const effectiveConfigs = useMemo(
    () => deriveEffectiveConfigs(SCOPE_DEMO_DEFINITION),
    [],
  );

  let actionNumber = 0;

  return (
    <div className="w-[480px] rounded-xl bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] p-5 [background-size:16px_16px]">
      {flatSteps.map(({ step }, index) => {
        const thisConfig = effectiveConfigs[index];
        const labels = resolveLabels(
          thisConfig?.effectiveHarness ?? "",
          thisConfig?.effectiveModel ?? "",
        );

        if (thisConfig?.isNewSession) {
          return (
            <WorkflowScopeHeader
              key={`scope-${index}`}
              variant={index === 0 ? "initial" : "new-session"}
              harness={labels.harness}
              model={labels.model}
              selected={selected === index}
              onSelect={() => setSelected(index)}
            />
          );
        }

        if (step.kind === "agent.config") {
          return (
            <WorkflowScopeHeader
              key={`scope-${index}`}
              variant="model-only"
              harness={labels.harness}
              model={labels.model}
              selected={selected === index}
              canMoveUp={index > 0}
              canMoveDown={index < flatSteps.length - 1}
              onSelect={() => setSelected(index)}
              onDuplicate={() => undefined}
              onDelete={() => undefined}
              onMoveUp={() => undefined}
              onMoveDown={() => undefined}
            />
          );
        }

        actionNumber += 1;
        const nextIsAction =
          flatSteps[index + 1] !== undefined && flatSteps[index + 1]!.step.kind !== "agent.config";
        return (
          <WorkflowStepRailCard
            key={index}
            step={step}
            index={index}
            stepNumber={actionNumber}
            selected={selected === index}
            invalid={false}
            connector={nextIsAction}
            canMoveUp={index > 0}
            canMoveDown={index < flatSteps.length - 1}
            onSelect={() => setSelected(index)}
            onChange={() => undefined}
            onDuplicate={() => undefined}
            onDelete={() => undefined}
            onMoveUp={() => undefined}
            onMoveDown={() => undefined}
          />
        );
      })}
      <div className="flex justify-start pl-[6px]">
        <Button
          type="button"
          aria-label="Add step"
          variant="unstyled"
          size="unstyled"
          className="flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm"
        >
          +
        </Button>
      </div>
    </div>
  );
}

// --- Original panel host for the editor panels ---

const CONFIG_STEP: WorkflowStep = { kind: "agent.config", onFail: { kind: "stop" }, model: "sonnet" };
const SHELL_STEP: WorkflowStep = {
  kind: "shell.run",
  onFail: { kind: "continue" },
  command: "pnpm install --frozen-lockfile && pnpm build && make test",
  outputName: "results",
};
const PROMPT_STEP: WorkflowStep = {
  kind: "agent.prompt",
  onFail: { kind: "stop" },
  prompt:
    "Triage the failing CI run for PR {{inputs.pr_number}}: read the logs, reproduce the failure locally, "
    + "fix the root cause rather than the symptom, and add a regression test so it cannot come back.",
  goal: {
    objective: "the full test suite passes",
    maxTurns: 25,
    maxWallSecs: 5400,
    tokenBudget: 400_000,
    onBlocked: "notify",
    verify: { shell: "make test", expectExit: 0 },
  },
};

function PanelHost({ initial, title }: { initial: WorkflowStep; title: string }) {
  const [step, setStep] = useState<WorkflowStep>(initial);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-faint">{title}</span>
      <div className="h-[560px] w-[400px] overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        <WorkflowStepPanel
          step={step}
          effectiveHarness="claude"
          agents={AGENTS}
          suggestions={SUGGESTIONS}
          slackConnected={false}
          slackChannels={[]}
          includableWorkflows={[]}
          integrations={["functions", "slack"]}
          functionInvocations={[{ name: "capture_event", displayName: "Capture event" }]}
          supportsGoals={() => true}
          onChange={setStep}
          onClose={() => undefined}
        />
      </div>
    </div>
  );
}

export function WorkflowEditorFixtures() {
  return (
    <div className="flex flex-wrap gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Scope-aware rail — agent config as scope boundary, actions numbered 1..N</h2>
        <p className="max-w-lg text-xs text-faint">
          Agent config is a scope boundary (◆ header), not a numbered step. Initial scope header →
          action 1, 2 → model-only header (quiet, opus) → action 3 → new-session header (opencode,
          emphasis) → action 4. Numbers run 1..4 on actions only; headers are unnumbered.
        </p>
        <ScopeDemoRail />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Edit panel — label-left inline rows (F4-C)</h2>
        <div className="flex flex-wrap gap-6">
          <PanelHost title="Agent — harness + model, own step" initial={CONFIG_STEP} />
          <PanelHost title="Prompt + goal (no model/harness rows)" initial={PROMPT_STEP} />
          <PanelHost title="Script (shell) — mono only in the $-gutter" initial={SHELL_STEP} />
        </div>
      </section>
    </div>
  );
}
