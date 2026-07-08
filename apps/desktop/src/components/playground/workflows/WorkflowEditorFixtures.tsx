import { useState, useMemo } from "react";
import type { WorkflowDefinition, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
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
  { token: "{{args.pr_number}}", label: "args.pr_number", detail: "argument · number", kind: "arg" },
  { token: "{{steps.1.output}}", label: "steps.1.output", detail: "step 1 · Prompt output", kind: "stepOutput" },
];

// --- Scope-demo rail: exercises all scope-boundary cases ---
// Setup: claude · sonnet → INITIAL scope header (unnumbered)
// Step 0: agent.prompt   → action 1
// Step 1: shell.run      → action 2
// Step 2: agent.config model-only → opus → MODEL-ONLY scope header (quiet, unnumbered)
// Step 3: agent.prompt   → action 3
// Step 4: agent.config harness → opencode → NEW-SESSION scope header (emphasis, unnumbered)
// Step 5: agent.prompt   → action 4

const SCOPE_DEMO_STEPS: WorkflowStep[] = [
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
  { kind: "agent.config", onFail: { kind: "stop" }, harness: "opencode", model: "gpt-4o" },
  { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "Review the changes from a second perspective and suggest any improvements." },
];

const SCOPE_DEMO_DEFINITION: WorkflowDefinition = {
  args: [],
  setup: { harness: "claude", model: "sonnet", sessionBinding: "fresh" },
  steps: SCOPE_DEMO_STEPS,
};

function resolveLabels(harnessKind: string, modelId: string) {
  const agent = AGENTS.find((a) => a.kind === harnessKind);
  return {
    harness: agent?.displayName ?? (harnessKind || "No agent"),
    model: agent?.models.find((m) => m.id === modelId)?.label ?? modelId ?? "",
  };
}

function ScopeDemoRail() {
  // -1 selects the initial (setup) scope header.
  const [selected, setSelected] = useState<number>(0);
  const effectiveConfigs = useMemo(
    () => deriveEffectiveConfigs(SCOPE_DEMO_DEFINITION),
    [],
  );

  let actionNumber = 0;

  return (
    <div className="w-[480px] rounded-xl bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] p-5 [background-size:16px_16px]">
      <WorkflowScopeHeader
        variant="initial"
        {...resolveLabels(SCOPE_DEMO_DEFINITION.setup.harness, SCOPE_DEMO_DEFINITION.setup.model)}
        selected={selected === -1}
        onSelect={() => setSelected(-1)}
      />
      {SCOPE_DEMO_STEPS.map((step, index) => {
        const thisConfig = effectiveConfigs[index];

        if (step.kind === "agent.config") {
          const labels = resolveLabels(
            thisConfig?.effectiveHarness ?? step.harness ?? "",
            thisConfig?.effectiveModel ?? step.model ?? "",
          );
          return (
            <WorkflowScopeHeader
              key={index}
              variant={thisConfig?.isNewSession ? "new-session" : "model-only"}
              harness={labels.harness}
              model={labels.model}
              selected={selected === index}
              canMoveUp={index > 0}
              canMoveDown={index < SCOPE_DEMO_STEPS.length - 1}
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
          SCOPE_DEMO_STEPS[index + 1] !== undefined &&
          SCOPE_DEMO_STEPS[index + 1]!.kind !== "agent.config";
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
            canMoveDown={index < SCOPE_DEMO_STEPS.length - 1}
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
        <button
          type="button"
          aria-label="Add step"
          className="flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm"
        >
          +
        </button>
      </div>
    </div>
  );
}

// --- Original panel host for the editor panels ---

const CONFIG_STEP: WorkflowStep = { kind: "agent.config", onFail: { kind: "stop" }, harness: "claude", model: "sonnet" };
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
    "Triage the failing CI run for PR {{args.pr_number}}: read the logs, reproduce the failure locally, "
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
