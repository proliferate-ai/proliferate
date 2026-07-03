import type { WorkflowDefinition } from "@proliferate/product-domain/workflows/definition";
import {
  deriveStepRunViews,
  workflowRunStatusLabel,
  workflowRunStatusTone,
  type WorkflowRunStatus,
} from "@proliferate/product-domain/workflows/run-status";
import { WorkflowRunTimelineRow } from "@proliferate/product-ui/workflows/WorkflowRunTimelineRow";
import { WorkflowStatusPill } from "@proliferate/product-ui/workflows/WorkflowStatusPill";
import { WORKFLOW_TEMPLATES } from "@proliferate/product-domain/workflows/templates";

const FIX_UNTIL_GREEN = WORKFLOW_TEMPLATES[0]!.definition; // shell -> goal prompt -> pr

const APPROVAL_DEFINITION: WorkflowDefinition = {
  args: [],
  setup: { harness: "claude", model: "sonnet", sessionBinding: "fresh" },
  steps: [
    { kind: "shell.run", onFail: { kind: "stop" }, command: "make build", outputName: "build" },
    { kind: "human.approval", onFail: { kind: "stop" }, message: "Approve deploy?", onTimeout: "fail" },
    { kind: "notify", onFail: { kind: "continue" }, channel: "slack", message: "Deployed." },
  ],
};

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
    label: "Running · goal-iterating",
    definition: FIX_UNTIL_GREEN,
    status: "running",
    stepCursor: 1,
    stepOutputs: { "0": { exit_code: 1 }, "1": GOAL_OUTPUT },
  },
  {
    label: "Failed",
    definition: FIX_UNTIL_GREEN,
    status: "failed",
    stepCursor: 0,
    stepOutputs: { "0": { exit_code: 1 } },
  },
  {
    label: "Waiting for approval",
    definition: APPROVAL_DEFINITION,
    status: "waiting_approval",
    stepCursor: 1,
    stepOutputs: { "0": { exit_code: 0 } },
    approval: true,
  },
  {
    label: "Completed",
    definition: FIX_UNTIL_GREEN,
    status: "completed",
    stepCursor: null,
    stepOutputs: {
      "0": { exit_code: 0 },
      "1": { ...GOAL_OUTPUT, goal: { ...GOAL_OUTPUT.goal, status: "met", iterations: 6, tokens_used: 128_000 } },
      "2": { pr_number: 912, pr_url: "https://github.com/proliferate-ai/proliferate/pull/912" },
    },
  },
];

function ApprovalControls() {
  return (
    <div className="flex gap-2">
      <button type="button" className="rounded-md border border-success/40 px-2.5 py-1 text-xs text-success">
        Approve
      </button>
      <button type="button" className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
        Deny
      </button>
    </div>
  );
}

function RunTimeline({ scenario }: { scenario: RunScenario }) {
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
      <h2 className="text-ui-sm font-semibold text-muted-foreground">
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
