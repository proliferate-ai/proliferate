import { Button } from "@proliferate/ui/primitives/Button";
import { flattenWorkflowSteps, type WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import {
  deriveStepRunViews,
  workflowRunStatusLabel,
  workflowRunStatusTone,
  type WorkflowRunStatus,
} from "@proliferate/product-domain/workflows/run-status";
import { WorkflowRunTimelineRow } from "@proliferate/product-ui/workflows/WorkflowRunTimelineRow";
import { WorkflowStatusPill } from "@proliferate/product-ui/workflows/WorkflowStatusPill";
import { workflowStepPreview } from "@proliferate/product-domain/workflows/presentation";
import { WORKFLOW_TEMPLATES } from "@proliferate/product-domain/workflows/templates";

const FIX_UNTIL_GREEN = WORKFLOW_TEMPLATES[0]!.definition; // shell -> goal prompt -> pr

// Sentry triage's goal is `onBlocked: "pause_for_approval"` — the waiting-approval scenario.
const APPROVAL_DEFINITION = WORKFLOW_TEMPLATES[1]!.definition;

const GOAL_OUTPUT = {
  goal: { objective: "the full test suite passes", status: "active", iterations: 3, tokens_used: 64_000 },
  session_id: "sess_demo",
  workspace_id: "ws_demo",
};

interface RunScenario {
  label: string;
  definition: WorkflowDefinition;
  status: WorkflowRunStatus;
  stepCursor: number | null;
  stepOutputs?: Record<string, unknown>;
  approval?: boolean;
}

const SCENARIOS: RunScenario[] = [
  {
    // FIX_UNTIL_GREEN: shell (0.-.0) -> goal prompt (0.-.1) -> pr (0.-.2).
    label: "Running · goal-iterating",
    definition: FIX_UNTIL_GREEN,
    status: "running",
    stepCursor: 1,
    stepOutputs: {
      "0.-.0": { exit_code: 1 },
      "0.-.1": GOAL_OUTPUT,
    },
  },
  {
    label: "Failed",
    definition: FIX_UNTIL_GREEN,
    status: "failed",
    stepCursor: 0,
    stepOutputs: { "0.-.0": { exit_code: 1 } },
  },
  {
    label: "Waiting for approval",
    definition: APPROVAL_DEFINITION,
    status: "waiting_approval",
    stepCursor: 0,
    stepOutputs: { "0.-.0": GOAL_OUTPUT },
    approval: true,
  },
  {
    label: "Completed",
    definition: FIX_UNTIL_GREEN,
    status: "completed",
    stepCursor: null,
    stepOutputs: {
      "0.-.0": { exit_code: 0 },
      "0.-.1": { ...GOAL_OUTPUT, goal: { ...GOAL_OUTPUT.goal, status: "met", iterations: 6, tokens_used: 128_000 } },
      "0.-.2": { pr_number: 912, pr_url: "https://github.com/proliferate-ai/proliferate/pull/912" },
    },
  },
];

function ApprovalControls() {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        className="rounded-md border border-success/40 px-2.5 py-1 text-xs text-success"
      >
        Approve
      </Button>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground"
      >
        Deny
      </Button>
    </div>
  );
}

function RunTimeline({ scenario }: { scenario: RunScenario }) {
  const flatSteps = flattenWorkflowSteps(scenario.definition);
  const views = deriveStepRunViews({
    definition: scenario.definition,
    runStatus: scenario.status,
    stepCursor: scenario.stepCursor,
    stepOutputs: scenario.stepOutputs,
    anyharnessWorkspaceId: "ws_demo",
  });
  return (
    <div className="w-[26rem] rounded-[12px] border border-border bg-background p-4">
      <div className="mb-3 flex items-center gap-2">
        <WorkflowStatusPill
          label={workflowRunStatusLabel(scenario.status)}
          tone={workflowRunStatusTone(scenario.status)}
          live={scenario.status === "running" || scenario.status === "waiting_approval"}
        />
        <span className="text-xs text-faint">Manual · 1m 20s · $0.42</span>
      </div>
      {views.map((view, index) => (
        <WorkflowRunTimelineRow
          key={view.index}
          view={view}
          preview={
            flatSteps[index]
              ? workflowStepPreview(flatSteps[index]!.step)
              : null
          }
          durationLabel={view.status === "completed" ? "18s" : undefined}
          connector={index < views.length - 1}
          onOpenSession={() => undefined}
          approvalControls={
            scenario.approval && view.status === "waiting_approval" ? <ApprovalControls /> : undefined
          }
        />
      ))}
    </div>
  );
}

export function WorkflowRunTimelineFixtures() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Run timeline — every state
      </h2>
      <div className="flex flex-wrap gap-6">
        {SCENARIOS.map((scenario) => (
          <div key={scenario.label} className="flex flex-col gap-1">
            <span className="text-xs text-faint">{scenario.label}</span>
            <RunTimeline scenario={scenario} />
          </div>
        ))}
      </div>
    </section>
  );
}
