import { useState } from "react";
import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import { Button } from "@proliferate/ui/primitives/Button";
import { WorkflowRunArgsModal, type WorkflowRunTargetOption } from "@/components/workflows/home/WorkflowRunArgsModal";
import { WorkflowMetaCard } from "@/components/workflows/editor/WorkflowMetaCard";
import { WorkflowSetupCard } from "@/components/workflows/editor/WorkflowSetupCard";
import {
  WorkflowFunctionsCard,
  type WorkflowFunctionProviderOption,
} from "@/components/workflows/editor/WorkflowFunctionsCard";
import {
  TriggerBadgeRow,
  TriggerForm,
  type TriggerDraft,
  type WorkflowTriggerRepoOption,
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

// D16: triggers pin a repo; the server derives + owns the workspace.
const REPO_OPTIONS: WorkflowTriggerRepoOption[] = [
  { fullName: "acme/proliferate", label: "acme/proliferate" },
  { fullName: "acme/web", label: "acme/web" },
];

const ARGS: WorkflowInputSpec[] = [
  { name: "pr_number", type: "number", required: true },
  { name: "env", type: "choice", choices: ["staging", "prod"], required: false, default: "staging" },
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
    repoFullName: "acme/proliferate",
    targetWorkspaceId: "ws-1",
    inputPresets: {},
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

const FUNCTION_PROVIDERS: WorkflowFunctionProviderOption[] = [
  { namespace: "issues", displayName: "Issues Service", connected: true },
  { namespace: "slack", displayName: "Slack", connected: false },
];

const INTEGRATION_GRANTS: string[] = ["issues"];

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
  const [args, setArgs] = useState<WorkflowInputSpec[]>(ARGS);
  const [integrations, setIntegrations] = useState<string[]>(INTEGRATION_GRANTS);
  const [emptyIntegrations, setEmptyIntegrations] = useState<string[]>([]);
  const [runModalOpen, setRunModalOpen] = useState(false);

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
    repoFullName: "acme/proliferate",
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
    repoFullName: "acme/proliferate",
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
        <WorkflowSetupCard inputs={args} agents={AGENTS} onInputsChange={setArgs} />

        <div className="flex flex-col gap-2">
          <span className="text-xs text-faint">Integrations — namespace toggles (E3), loud cloud-only caption</span>
          <WorkflowFunctionsCard integrations={integrations} providers={FUNCTION_PROVIDERS} onChange={setIntegrations} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-faint">Integrations — no visible Issues/Slack integration yet</span>
          <WorkflowFunctionsCard integrations={emptyIntegrations} providers={[]} onChange={setEmptyIntegrations} />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-sm">
          <span className="text-sm font-medium text-foreground">Triggers — schedule + poll chips, poll error caption</span>
          <TriggerBadgeRow
            triggers={TRIGGERS}
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
            repoOptions={REPO_OPTIONS}
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
            repoOptions={REPO_OPTIONS}
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

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4 shadow-sm">
          <span className="text-sm font-medium text-foreground">
            Run modal — local-lane integrations warning + L22 no-ready-account error
          </span>
          <p className="text-xs text-faint">
            Opens with target &quot;On this Mac&quot; against a workflow that declares integrations —
            exercises the warning caption and the enumerated-error + Settings link together.
          </p>
          <Button size="sm" className="self-start" onClick={() => setRunModalOpen(true)}>
            Open run modal
          </Button>
          <WorkflowRunArgsModal
            open={runModalOpen}
            workflowName="Triage new issues"
            args={ARGS}
            localWorkspaces={[{ id: "local-1", label: "proliferate (local)" }]}
            cloudWorkspaces={CLOUD_WORKSPACES}
            hasIntegrations
            error="This workflow grants the 'issues' integration, but you have no ready 'issues' integration. Connect it before running."
            onOpenIntegrationsSettings={() => {}}
            onClose={() => setRunModalOpen(false)}
            onSubmit={() => setRunModalOpen(false)}
          />
        </div>
      </div>
    </section>
  );
}
