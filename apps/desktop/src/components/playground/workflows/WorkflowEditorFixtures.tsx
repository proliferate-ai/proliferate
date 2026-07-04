import { useState } from "react";
import type { WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
import { WorkflowStepPanel, type EditorAgent } from "@/components/workflows/editor/WorkflowStepPanel";
import { WorkflowStepRailCard } from "@/components/workflows/editor/WorkflowStepRailCard";

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
];

const SUGGESTIONS: TemplateSuggestion[] = [
  { token: "{{args.pr_number}}", label: "args.pr_number", detail: "argument · number", kind: "arg" },
  { token: "{{steps.1.output}}", label: "steps.1.output", detail: "step 1 · Prompt output", kind: "stepOutput" },
];

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
const EMPTY_STEP: WorkflowStep = { kind: "agent.prompt", onFail: { kind: "stop" }, prompt: "" };

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

const RAIL: WorkflowStep[] = [CONFIG_STEP, PROMPT_STEP, SHELL_STEP, EMPTY_STEP];

export function WorkflowEditorFixtures() {
  const [selected, setSelected] = useState(1);
  return (
    <div className="flex flex-wrap gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Editor rail — numbered spine (F), outline pills, agent step</h2>
        <div className="w-[440px] rounded-xl bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] p-5 [background-size:16px_16px]">
          {RAIL.map((step, index) => (
            <WorkflowStepRailCard
              key={index}
              step={step}
              index={index}
              selected={selected === index}
              invalid={index === RAIL.length - 1}
              connector
              canMoveUp={index > 0}
              canMoveDown={index < RAIL.length - 1}
              onSelect={() => setSelected(index)}
              onChange={() => undefined}
              onDuplicate={() => undefined}
              onDelete={() => undefined}
              onMoveUp={() => undefined}
              onMoveDown={() => undefined}
            />
          ))}
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
