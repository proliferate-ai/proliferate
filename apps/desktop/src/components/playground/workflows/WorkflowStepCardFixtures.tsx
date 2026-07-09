import type { WorkflowStep } from "@proliferate/product-domain/workflows/definition";
import { WorkflowStepCard } from "@proliferate/product-ui/workflows/WorkflowStepCard";
import { WorkflowStepKindBadge } from "@proliferate/product-ui/workflows/WorkflowStepKindBadge";
import { WorkflowStepGlyphStrip } from "@proliferate/product-ui/workflows/WorkflowStepGlyphStrip";
import { workflowStepStrip } from "@proliferate/product-domain/workflows/presentation";
import { WORKFLOW_TEMPLATES } from "@proliferate/product-domain/workflows/templates";

const PROMPT_STEP: WorkflowStep = {
  kind: "agent.prompt",
  onFail: { kind: "stop" },
  prompt: "Investigate the failing tests, fix the root cause, and re-run them to confirm.",
};

const GOAL_STEP: WorkflowStep = {
  kind: "agent.prompt",
  onFail: { kind: "stop" },
  prompt: "The test suite is failing. Fix it.",
  goal: {
    objective: "the full test suite passes with no failing tests",
    maxTurns: 25,
    maxWallSecs: 5400,
    tokenBudget: 400_000,
    onBlocked: "notify",
    verify: { shell: "make test", expectExit: 0 },
  },
};

const CONFIG_STEP: WorkflowStep = {
  kind: "agent.config",
  onFail: { kind: "stop" },
  model: "sonnet",
};

const SHELL_STEP: WorkflowStep = {
  kind: "shell.run",
  onFail: { kind: "continue" },
  command: "make test",
  outputName: "results",
};

const PR_STEP: WorkflowStep = {
  kind: "scm.open_pr",
  onFail: { kind: "retry", n: 1 },
  title: "Fix flaky login test",
  body: "Automated fix from the fix-until-green workflow.",
  draft: true,
};

const NOTIFY_STEP: WorkflowStep = {
  kind: "notify",
  onFail: { kind: "continue" },
  slackChannelId: "general",
  message: "QA finished for PR #912.",
};

const BRANCH_STEP: WorkflowStep = {
  kind: "branch",
  onFail: { kind: "stop" },
  on: "{{verdict.verdict}}",
  cases: { pass: { to: "continue" }, fail: { to: "end" } },
};

interface Labeled {
  label: string;
  step: WorkflowStep;
  selected?: boolean;
  invalid?: boolean;
}

const STEP_CARDS: Labeled[] = [
  { label: "Agent (agent.config)", step: CONFIG_STEP },
  { label: "Prompt", step: PROMPT_STEP },
  { label: "Prompt + goal attachment (two-line)", step: GOAL_STEP },
  { label: "Script (shell.run)", step: SHELL_STEP },
  { label: "Open PR", step: PR_STEP },
  { label: "Notify (Slack)", step: NOTIFY_STEP },
  { label: "Branch", step: BRANCH_STEP },
  { label: "Selected", step: GOAL_STEP, selected: true },
  { label: "Empty content (preview box collapses)", step: { ...PROMPT_STEP, prompt: "" } },
  { label: "Invalid (needs attention)", step: { ...PROMPT_STEP, prompt: "" }, invalid: true },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-[22rem] flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function WorkflowStepCardFixtures() {
  return (
    <div className="flex flex-wrap gap-10">
      <Section title="Step cards — every kind + goal attachment">
        <div className="flex w-[24rem] flex-col gap-3">
          {STEP_CARDS.map(({ label, step, selected, invalid }, index) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-xs text-faint">{label}</span>
              <WorkflowStepCard
                step={step}
                index={index}
                selected={selected}
                invalid={invalid}
                onSelect={() => undefined}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Editor rail (connected chain)">
        <div className="flex w-[24rem] flex-col">
          {[CONFIG_STEP, GOAL_STEP, SHELL_STEP, PR_STEP].map((step, index, all) => (
            <WorkflowStepCard
              key={index}
              step={step}
              index={index}
              selected={index === 1}
              connector={index < all.length - 1}
              onSelect={() => undefined}
            />
          ))}
        </div>
      </Section>

      <Section title="Kind badges & glyph strips">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            {(["agent.prompt", "agent.config", "shell.run", "scm.open_pr", "notify", "branch"] as const).map(
              (kind) => (
                <WorkflowStepKindBadge key={kind} kind={kind} />
              ),
            )}
          </div>
          <div className="flex flex-col gap-2">
            {WORKFLOW_TEMPLATES.map((template) => (
              <div key={template.id} className="flex items-center gap-2">
                <WorkflowStepGlyphStrip glyphs={workflowStepStrip(template.definition)} />
                <span className="text-sm text-muted-foreground">{template.name}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
