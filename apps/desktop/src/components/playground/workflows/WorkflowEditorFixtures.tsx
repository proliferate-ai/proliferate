import { useState, useMemo } from "react";
import type { WorkflowDefinition, WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { deriveEffectiveConfigs } from "@proliferate/product-domain/workflows/effective-config";
import { WorkflowStepPanel, type EditorAgent } from "@/components/workflows/editor/WorkflowStepPanel";
import { WorkflowStepRailCard } from "@/components/workflows/editor/WorkflowStepRailCard";
import { WorkflowStepConnector } from "@/components/workflows/editor/WorkflowStepConnector";

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

// --- Scope-demo rail: exercises all scope cases ---
// Setup: claude · sonnet
// Step 0: agent.prompt (opens first session — scope 0)
// Step 1: shell.run (same scope)
// Step 2: agent.config model-only → opus (same session — no break)
// Step 3: agent.prompt (continues session, model changed)
// Step 4: agent.config harness → codex (NEW session — break)
// Step 5: agent.prompt (in codex session)

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

function ScopeDemoRail() {
  const [selected, setSelected] = useState(0);
  const effectiveConfigs = useMemo(
    () => deriveEffectiveConfigs(SCOPE_DEMO_DEFINITION),
    [],
  );

  return (
    <div className="w-[480px] rounded-xl bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] p-5 [background-size:16px_16px]">
      {SCOPE_DEMO_STEPS.map((step, index) => {
        const nextConfig = effectiveConfigs[index + 1];
        const nextIsNewSession = nextConfig?.isNewSession === true;
        const thisConfig = effectiveConfigs[index];
        const isFirstInScope = thisConfig && (
          index === 0 || thisConfig.scopeIndex !== effectiveConfigs[index - 1]?.scopeIndex
        );
        const scopeLabel = isFirstInScope && thisConfig
          ? `${thisConfig.effectiveHarness} · ${thisConfig.effectiveModel}`
          : null;

        return (
          <div key={index}>
            <WorkflowStepRailCard
              step={step}
              index={index}
              selected={selected === index}
              invalid={false}
              connector={!nextIsNewSession}
              canMoveUp={index > 0}
              canMoveDown={index < SCOPE_DEMO_STEPS.length - 1}
              onSelect={() => setSelected(index)}
              onChange={() => undefined}
              onDuplicate={() => undefined}
              onDelete={() => undefined}
              onMoveUp={() => undefined}
              onMoveDown={() => undefined}
              scopeAnnotation={
                step.kind === "agent.config" && thisConfig
                  ? thisConfig
                  : null
              }
              scopeLabel={scopeLabel}
            />
            {nextIsNewSession ? (
              <WorkflowStepConnector
                sessionBreak={{ label: `new session · ${nextConfig.effectiveHarness}` }}
              />
            ) : null}
          </div>
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
        <h2 className="text-sm font-semibold text-muted-foreground">Scope-aware rail — session boundaries + scope labels</h2>
        <p className="max-w-lg text-xs text-faint">
          Setup: claude/sonnet. Steps 1-4 share scope 0 (model-only change to opus at step 3 continues
          the session). Step 5 switches harness to opencode — the connector shows a session break, and
          step 6 gets a new scope label.
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
