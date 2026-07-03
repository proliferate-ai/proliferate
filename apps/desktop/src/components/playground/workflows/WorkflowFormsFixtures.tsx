import { useState } from "react";
import type { WorkflowArgSpec, WorkflowSetup } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowRunTargetOption } from "@/components/workflows/home/WorkflowRunArgsModal";
import { WorkflowMetaCard } from "@/components/workflows/editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "@/components/workflows/editor/WorkflowSetupCard";
import {
  TriggerBadgeRow,
  TriggerScheduleForm,
  type TriggerDraft,
  type WorkflowTriggerResponse,
} from "@/components/workflows/editor/WorkflowTriggersCard";
import { presetForRrule } from "@/lib/domain/automations/schedule/schedule";
import type { EditorAgent } from "@/components/workflows/editor/WorkflowStepPanel";

const AGENTS: EditorAgent[] = [
  { kind: "claude", displayName: "Claude Code", models: [{ id: "opus", label: "Opus 4.8" }] },
  { kind: "codex", displayName: "Codex", models: [{ id: "gpt", label: "GPT-5" }] },
];

const CLOUD_WORKSPACES: WorkflowRunTargetOption[] = [
  { id: "ws-1", label: "proliferate · cloud" },
  { id: "ws-2", label: "web · cloud" },
];

const ARGS: WorkflowArgSpec[] = [
  { name: "pr_number", type: "number", required: true },
  { name: "env", type: "enum", enum: ["staging", "prod"], required: false, default: "staging" },
];

const DAILY_RRULE = "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0";

function makeTrigger(overrides: Partial<WorkflowTriggerResponse>): WorkflowTriggerResponse {
  return {
    id: "trig-1",
    workflowId: "wf-1",
    kind: "schedule",
    enabled: true,
    concurrencyPolicy: "skip",
    targetMode: "personal_cloud",
    targetWorkspaceId: "ws-1",
    schedule: { rrule: DAILY_RRULE, timezone: "America/Los_Angeles", summary: "Every day at 9:00 AM" },
    nextRunAt: "2026-07-04T16:00:00Z",
    lastScheduledAt: null,
    lastSkippedAt: null,
    lastSkipReason: null,
    args: {},
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const TRIGGERS: WorkflowTriggerResponse[] = [
  makeTrigger({ id: "trig-1" }),
  makeTrigger({
    id: "trig-2",
    enabled: false,
    schedule: { rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", timezone: "America/Los_Angeles", summary: "Weekly on Monday" },
    lastSkipReason: "previous run still running",
  }),
];

/**
 * Setup / meta / triggers cards — exercises the swept Input/Textarea primitives,
 * the WorkflowSelect popover pickers, the redesigned Setup arg table, and the
 * Ona-style trigger badge row + inline schedule form (rendered from the card's
 * pure sub-components so no query client is needed).
 */
export function WorkflowFormsFixtures() {
  const [name, setName] = useState("Fix until green");
  const [description, setDescription] = useState("Investigate and fix failing tests until the suite passes.");
  const [setup, setSetup] = useState<WorkflowSetup>({ harness: "claude", model: "opus", sessionBinding: "fresh" });
  const [args, setArgs] = useState<WorkflowArgSpec[]>(ARGS);

  const [draft, setDraft] = useState<TriggerDraft>({
    rrule: DAILY_RRULE,
    timezone: "America/Los_Angeles",
    preset: presetForRrule(DAILY_RRULE),
    concurrency: "skip",
    enabled: true,
    workspaceId: "ws-1",
    argValues: { pr_number: "912", env: "staging" },
  });
  const patchDraft = (patch: Partial<TriggerDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Meta / Setup / Triggers cards</h2>
      <div className="flex w-[560px] flex-col gap-3">
        <WorkflowMetaCard
          name={name}
          description={description}
          onNameChange={setName}
          onDescriptionChange={setDescription}
        />
        <WorkflowSetupCard setup={setup} args={args} agents={AGENTS} onSetupChange={setSetup} onArgsChange={setArgs} />

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-sm">
          <span className="text-sm font-medium text-foreground">Triggers</span>
          <TriggerBadgeRow
            triggers={TRIGGERS}
            cloudWorkspaces={CLOUD_WORKSPACES}
            activeId={undefined}
            addActive={false}
            addDisabled={false}
            onAddSchedule={() => {}}
            onEditSchedule={() => {}}
          />
          <p className="text-xs text-faint">Runs manually from here or the runs list; schedules fire in the cloud.</p>
          <TriggerScheduleForm
            draft={draft}
            args={args}
            cloudWorkspaces={CLOUD_WORKSPACES}
            error={null}
            busy={false}
            isEdit
            canDelete
            deleting={false}
            onPatch={patchDraft}
            onSubmit={() => {}}
            onCancel={() => {}}
            onDelete={() => {}}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-sm">
          <span className="text-sm font-medium text-foreground">Triggers — no cloud workspace</span>
          <TriggerBadgeRow
            triggers={[]}
            cloudWorkspaces={[]}
            activeId={undefined}
            addActive={false}
            addDisabled
            onAddSchedule={() => {}}
            onEditSchedule={() => {}}
          />
          <p className="text-xs text-faint">
            Scheduled runs execute in the cloud. Create a cloud workspace to schedule this workflow; local schedules are
            coming — run it manually for now.
          </p>
        </div>
      </div>
    </section>
  );
}
