import { useState } from "react";
import type { WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import type { TemplateSuggestion } from "@proliferate/product-domain/workflows/interpolation";
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
];

const SUGGESTIONS: TemplateSuggestion[] = [
  { token: "{{args.pr_number}}", label: "args.pr_number", detail: "argument · number", kind: "arg" },
  { token: "{{steps.1.output}}", label: "steps.1.output", detail: "step 1 · Prompt output", kind: "stepOutput" },
];

const SHELL_STEP: WorkflowStep = { kind: "shell.run", onFail: { kind: "continue" }, command: "make test", outputName: "results" };
const PROMPT_STEP: WorkflowStep = {
  kind: "agent.prompt",
  onFail: { kind: "stop" },
  prompt: "The test suite is failing. Fix it.",
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
          setupHarness="claude"
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

const RAIL: WorkflowStep[] = [SHELL_STEP, PROMPT_STEP, EMPTY_STEP];

export function WorkflowEditorFixtures() {
  const [selected, setSelected] = useState(1);
  return (
    <div className="flex flex-wrap gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-ui-sm font-semibold text-muted-foreground">Editor rail — connectors + add step</h2>
        <div className="w-[440px] rounded-xl bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] p-5 [background-size:16px_16px]">
          {RAIL.map((step, index) => (
            <div key={index}>
              <WorkflowStepRailCard
                step={step}
                index={index}
                selected={selected === index}
                invalid={index === 2}
                canMoveUp={index > 0}
                canMoveDown={index < RAIL.length - 1}
                onSelect={() => setSelected(index)}
                onChange={() => undefined}
                onDuplicate={() => undefined}
                onDelete={() => undefined}
                onMoveUp={() => undefined}
                onMoveDown={() => undefined}
              />
              <WorkflowStepConnector />
            </div>
          ))}
          <div className="flex justify-start pl-[4px]">
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
        <h2 className="text-ui-sm font-semibold text-muted-foreground">Edit panel — per kind</h2>
        <div className="flex flex-wrap gap-6">
          <PanelHost title="Script (shell) — one bordered command field, $-gutter inside" initial={SHELL_STEP} />
          <PanelHost title="Prompt + goal attachment" initial={PROMPT_STEP} />
        </div>
      </section>
    </div>
  );
}
