import { useState } from "react";
import type { WorkflowArgSpec, WorkflowSetup } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowRunTargetOption } from "@/components/workflows/home/WorkflowRunArgsModal";
import { WorkflowMetaCard } from "@/components/workflows/editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "@/components/workflows/editor/WorkflowSetupCard";
import {
  TriggerBadgeRow,
  TriggerForm,
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
  makeTrigger({
    id: "trig-3",
    kind: "poll",
    schedule: null,
    poll: {
      url: "https://issues.example.com/poll/new-issues",
      authHeader: "Authorization",
      hasAuth: true,
      intervalSecs: 300,
      // Derived (read-only) from the workflow inputs — no authoring surface (D17).
      itemSchema: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
      lastPollAt: "2026-07-06T18:05:00Z",
      lastPollError: "GET failed: 503 Service Unavailable",
    },
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
    kind: "schedule",
    rrule: DAILY_RRULE,
    timezone: "America/Los_Angeles",
    preset: presetForRrule(DAILY_RRULE),
    pollUrl: "",
    pollAuthHeader: "",
    pollHasAuth: false,
    pollReplaceAuth: true,
    pollAuthValue: "",
    pollIntervalSecs: 300,
    concurrency: "skip",
    enabled: true,
    workspaceId: "ws-1",
    argValues: { pr_number: "912", env: "staging" },
  });
  const patchDraft = (patch: Partial<TriggerDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const [pollDraft, setPollDraft] = useState<TriggerDraft>({
    kind: "poll",
    rrule: DAILY_RRULE,
    timezone: "America/Los_Angeles",
    preset: presetForRrule(DAILY_RRULE),
    pollUrl: "https://issues.example.com/poll/new-issues",
    pollAuthHeader: "Authorization",
    pollHasAuth: true,
    pollReplaceAuth: false,
    pollAuthValue: "",
    pollIntervalSecs: 300,
    concurrency: "queue",
    enabled: true,
    workspaceId: "ws-1",
    argValues: { pr_number: "", env: "staging" },
  });
  const patchPollDraft = (patch: Partial<TriggerDraft>) => setPollDraft((prev) => ({ ...prev, ...patch }));

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
          <span className="text-sm font-medium text-foreground">Triggers — schedule + poll chips, poll error caption</span>
          <TriggerBadgeRow
            triggers={TRIGGERS}
            cloudWorkspaces={CLOUD_WORKSPACES}
            activeId={undefined}
            addingKind={null}
            addDisabled={false}
            onAdd={() => {}}
            onEditTrigger={() => {}}
          />
          <p className="text-xs text-faint">Runs manually from here or the runs list; schedules and polls fire in the cloud.</p>
          <TriggerForm
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
          <span className="text-sm font-medium text-foreground">Poll trigger form — secret configured/replace, schema, args mapping</span>
          <TriggerForm
            draft={pollDraft}
            args={args}
            cloudWorkspaces={CLOUD_WORKSPACES}
            error={null}
            busy={false}
            isEdit
            canDelete
            deleting={false}
            onPatch={patchPollDraft}
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
            addingKind={null}
            addDisabled
            onAdd={() => {}}
            onEditTrigger={() => {}}
          />
          <p className="text-xs text-faint">
            Scheduled and poll runs execute in the cloud. Create a cloud workspace to trigger this workflow that way;
            local triggers are coming — run it manually for now.
          </p>
        </div>
      </div>
    </section>
  );
}
