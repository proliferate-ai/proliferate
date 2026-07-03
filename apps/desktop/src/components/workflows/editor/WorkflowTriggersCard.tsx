import { useState } from "react";
import type { WorkflowArgSpec } from "@proliferate/product-domain/workflows/definition";
import type {
  WorkflowTriggerCreateRequest,
  WorkflowTriggerResponse,
} from "@/lib/access/cloud/workflows";
import {
  useWorkflowTriggers,
  useWorkflowTriggerMutations,
} from "@/hooks/access/cloud/workflows/use-workflow-triggers";
import {
  defaultAutomationTimezone,
  formatAutomationTimestamp,
  presetForRrule,
  timeForRrule,
  type AutomationSchedulePresetOrCustom,
} from "@/lib/domain/automations/schedule/schedule";
import { AutomationSchedulePopover } from "@/components/automations/editor/AutomationEditorControls";
import type { WorkflowRunTargetOption } from "@/components/workflows/home/WorkflowRunArgsModal";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Clock, Play, Plus, Trash } from "@proliferate/ui/icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { WorkflowSelect } from "./WorkflowSelect";

/** Re-exported so fixtures can build trigger data without importing access paths. */
export type { WorkflowTriggerResponse };

type ArgValue = string | number | boolean;
type Concurrency = "skip" | "queue";

export interface WorkflowTriggersCardProps {
  workflowId: string;
  /** The workflow's declared args — a scheduled run fires with fixed values. */
  args: readonly WorkflowArgSpec[];
  /** The owner's ready cloud workspaces (scheduled runs are cloud-only in v1). */
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
}

const DEFAULT_RRULE = "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0";

function initialArgValue(arg: WorkflowArgSpec): ArgValue {
  if (arg.default !== undefined) return arg.default;
  switch (arg.type) {
    case "boolean":
      return false;
    case "enum":
      return arg.enum?.[0] ?? "";
    default:
      return "";
  }
}

export interface TriggerDraft {
  rrule: string;
  timezone: string;
  preset: AutomationSchedulePresetOrCustom;
  concurrency: Concurrency;
  enabled: boolean;
  workspaceId: string;
  argValues: Record<string, ArgValue>;
}

function draftFromTrigger(
  trigger: WorkflowTriggerResponse | null,
  args: readonly WorkflowArgSpec[],
  cloudWorkspaces: readonly WorkflowRunTargetOption[],
): TriggerDraft {
  const rrule = trigger?.schedule?.rrule ?? DEFAULT_RRULE;
  const argValues: Record<string, ArgValue> = {};
  for (const arg of args) {
    const stored = trigger?.args?.[arg.name] as ArgValue | undefined;
    argValues[arg.name] = stored ?? initialArgValue(arg);
  }
  return {
    rrule,
    timezone: trigger?.schedule?.timezone ?? defaultAutomationTimezone(),
    preset: presetForRrule(rrule),
    concurrency: (trigger?.concurrencyPolicy as Concurrency) ?? "skip",
    enabled: trigger?.enabled ?? true,
    workspaceId: trigger?.targetWorkspaceId ?? cloudWorkspaces[0]?.id ?? "",
    argValues,
  };
}

function coerceArg(arg: WorkflowArgSpec, value: ArgValue): ArgValue {
  if (arg.type === "number") return value === "" ? "" : Number(value);
  return value;
}

/**
 * Triggers card (spec 3.5/3.6, Ona parity). Manual is an always-on chip;
 * schedules render as quiet chips (summary + next-run) in the same badge row,
 * with `Webhook`/`API` shown as disabled "soon" chips. Clicking a schedule chip
 * (or `+ Add schedule`) opens the inline schedule editor. Scheduled runs are
 * cloud-only in v1 — the picker offers cloud workspaces and the card explains
 * when none exist. Concurrency (`skip | queue`), enable/disable, next-run, and
 * the last-skip reason are all persisted per trigger.
 */
export function WorkflowTriggersCard({
  workflowId,
  args,
  cloudWorkspaces,
}: WorkflowTriggersCardProps) {
  const triggersQuery = useWorkflowTriggers(workflowId);
  const { createMutation, updateMutation, deleteMutation } =
    useWorkflowTriggerMutations(workflowId);

  const triggers = triggersQuery.data ?? [];
  const cloudAvailable = cloudWorkspaces.length > 0;

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [draft, setDraft] = useState<TriggerDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openForm = (trigger: WorkflowTriggerResponse | null) => {
    setError(null);
    setEditing({ id: trigger?.id ?? null });
    setDraft(draftFromTrigger(trigger, args, cloudWorkspaces));
  };

  const closeForm = () => {
    setEditing(null);
    setDraft(null);
    setError(null);
  };

  const patchDraft = (patch: Partial<TriggerDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const busy = createMutation.isPending || updateMutation.isPending;

  const submit = () => {
    if (!draft) return;
    if (!draft.workspaceId) {
      setError("Choose a cloud workspace for the scheduled run.");
      return;
    }
    const missing = args.find(
      (arg) => arg.required && (draft.argValues[arg.name] === "" || draft.argValues[arg.name] === undefined),
    );
    if (missing) {
      setError(`Provide a value for the required argument "${missing.name}".`);
      return;
    }
    const argsBody: Record<string, ArgValue> = {};
    for (const arg of args) {
      const value = coerceArg(arg, draft.argValues[arg.name] ?? "");
      if (value !== "") argsBody[arg.name] = value;
    }
    const body: WorkflowTriggerCreateRequest = {
      kind: "schedule",
      enabled: draft.enabled,
      concurrencyPolicy: draft.concurrency,
      targetMode: "personal_cloud",
      targetWorkspaceId: draft.workspaceId,
      schedule: { rrule: draft.rrule, timezone: draft.timezone },
      args: argsBody,
    };
    const onDone = { onSuccess: closeForm, onError: (e: Error) => setError(e.message) };
    if (editing?.id) {
      updateMutation.mutate({ triggerId: editing.id, body }, onDone);
    } else {
      createMutation.mutate(body, onDone);
    }
  };

  const removeTrigger = () => {
    if (!editing?.id) return;
    deleteMutation.mutate(editing.id, { onSuccess: closeForm });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-sm">
      <span className="text-sm font-medium text-foreground">Triggers</span>

      <TriggerBadgeRow
        triggers={triggers}
        cloudWorkspaces={cloudWorkspaces}
        activeId={editing?.id ?? undefined}
        addActive={editing !== null && editing.id === null}
        addDisabled={!cloudAvailable}
        onAddSchedule={() => openForm(null)}
        onEditSchedule={(trigger) => openForm(trigger)}
      />

      {!cloudAvailable ? (
        <p className="text-xs text-faint">
          Scheduled runs execute in the cloud. Create a cloud workspace to schedule this workflow;
          local schedules are coming — run it manually for now.
        </p>
      ) : (
        <p className="text-xs text-faint">Runs manually from here or the runs list; schedules fire in the cloud.</p>
      )}

      {editing && draft ? (
        <TriggerScheduleForm
          draft={draft}
          args={args}
          cloudWorkspaces={cloudWorkspaces}
          error={error}
          busy={busy}
          isEdit={editing.id !== null}
          canDelete={editing.id !== null}
          deleting={deleteMutation.isPending}
          onPatch={patchDraft}
          onSubmit={submit}
          onCancel={closeForm}
          onDelete={removeTrigger}
        />
      ) : null}
    </div>
  );
}

interface TriggerBadgeRowProps {
  triggers: readonly WorkflowTriggerResponse[];
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  activeId?: string | null;
  addActive: boolean;
  addDisabled: boolean;
  onAddSchedule: () => void;
  onEditSchedule: (trigger: WorkflowTriggerResponse) => void;
}

/** The Ona-style chip row: Manual + schedule chips + disabled "soon" chips + add. */
export function TriggerBadgeRow({
  triggers,
  cloudWorkspaces,
  activeId,
  addActive,
  addDisabled,
  onAddSchedule,
  onEditSchedule,
}: TriggerBadgeRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent px-2.5 py-1 text-sm text-foreground">
        <Play className="size-3.5" aria-hidden />
        Manual
      </span>

      {triggers.map((trigger) => (
        <ScheduleChip
          key={trigger.id}
          trigger={trigger}
          workspaceLabel={
            cloudWorkspaces.find((w) => w.id === trigger.targetWorkspaceId)?.label ?? "cloud workspace"
          }
          active={trigger.id === activeId}
          onClick={() => onEditSchedule(trigger)}
        />
      ))}

      <button
        type="button"
        disabled={addDisabled}
        title={addDisabled ? "Scheduled runs need a cloud workspace" : undefined}
        onClick={onAddSchedule}
        className={twMerge(
          "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:border-border-heavy hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground",
          addActive ? "border-solid border-border-heavy text-foreground" : "",
        )}
      >
        <Plus className="size-3.5" aria-hidden />
        Add schedule
      </button>

      <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
        Webhook · soon
      </span>
      <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
        API · soon
      </span>
    </div>
  );
}

function ScheduleChip({
  trigger,
  workspaceLabel,
  active,
  onClick,
}: {
  trigger: WorkflowTriggerResponse;
  workspaceLabel: string;
  active: boolean;
  onClick: () => void;
}) {
  const summary = trigger.schedule?.summary ?? "Schedule";
  const nextRun = trigger.enabled
    ? formatAutomationTimestamp(trigger.nextRunAt ?? null, trigger.schedule?.timezone)
    : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${workspaceLabel}${trigger.lastSkipReason ? ` · last skipped: ${trigger.lastSkipReason}` : ""}`}
      className={twMerge(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors",
        active ? "border-border-heavy bg-list-hover text-foreground" : "border-border bg-accent text-foreground hover:border-border-heavy",
        trigger.enabled ? "" : "opacity-55",
      )}
    >
      <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{summary}</span>
      <span className="text-xs text-faint">{trigger.enabled ? (nextRun ? `· ${nextRun}` : "") : "· off"}</span>
    </button>
  );
}

interface TriggerScheduleFormProps {
  draft: TriggerDraft;
  args: readonly WorkflowArgSpec[];
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  error: string | null;
  busy: boolean;
  isEdit: boolean;
  canDelete: boolean;
  deleting: boolean;
  onPatch: (patch: Partial<TriggerDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

/** The inline schedule editor — shared form rhythm, aligned rows, one size. */
export function TriggerScheduleForm({
  draft,
  args,
  cloudWorkspaces,
  error,
  busy,
  isEdit,
  canDelete,
  deleting,
  onPatch,
  onSubmit,
  onCancel,
  onDelete,
}: TriggerScheduleFormProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-elevated-secondary/40 p-3">
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Schedule</Label>
          <AutomationSchedulePopover
            schedulePreset={draft.preset}
            rrule={draft.rrule}
            timezone={draft.timezone}
            onSchedulePresetChange={(preset) => onPatch({ preset })}
            onRruleChange={(rrule) => onPatch({ rrule })}
            onTimezoneChange={(timezone) => onPatch({ timezone })}
            onRruleBlur={() => onPatch({ preset: presetForRrule(draft.rrule) })}
          />
          <span className="text-xs text-faint">
            Fires at {timeForRrule(draft.rrule)} · {draft.timezone}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Cloud workspace</Label>
          <WorkflowSelect
            ariaLabel="Cloud workspace"
            value={draft.workspaceId}
            options={cloudWorkspaces.map((workspace) => ({ value: workspace.id, label: workspace.label }))}
            onChange={(value) => onPatch({ workspaceId: value })}
          />
        </div>
      </div>

      {args.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <Label className="mb-0">Arguments</Label>
          {args.map((arg) => (
            <div key={arg.name} className="grid grid-cols-[10rem_1fr] items-center gap-2">
              <span className="flex min-w-0 items-center gap-1 truncate font-mono text-sm text-foreground">
                {arg.name}
                {arg.required ? <span className="text-destructive">*</span> : null}
                <span className="font-sans text-xs text-faint">· {arg.type}</span>
              </span>
              {arg.type === "boolean" ? (
                <div className="flex items-center">
                  <Switch
                    checked={Boolean(draft.argValues[arg.name])}
                    onChange={(checked) => onPatch({ argValues: { ...draft.argValues, [arg.name]: checked } })}
                  />
                </div>
              ) : arg.type === "enum" ? (
                <WorkflowSelect
                  ariaLabel={`${arg.name} value`}
                  value={String(draft.argValues[arg.name] ?? "")}
                  options={(arg.enum ?? []).map((option) => ({ value: option, label: option }))}
                  onChange={(value) => onPatch({ argValues: { ...draft.argValues, [arg.name]: value } })}
                />
              ) : (
                <Input
                  type={arg.type === "number" ? "number" : "text"}
                  value={String(draft.argValues[arg.name] ?? "")}
                  onChange={(event) => onPatch({ argValues: { ...draft.argValues, [arg.name]: event.target.value } })}
                  placeholder={arg.required ? "Required" : "Optional"}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>If still running when triggered</Label>
          <WorkflowSelect
            ariaLabel="Concurrency policy"
            value={draft.concurrency}
            options={[
              { value: "skip", label: "Skip this run" },
              { value: "queue", label: "Queue after" },
            ]}
            onChange={(value) => onPatch({ concurrency: value as Concurrency })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Status</Label>
          <label className="flex h-9 items-center gap-2 text-sm text-foreground">
            <Switch checked={draft.enabled} onChange={(enabled) => onPatch({ enabled })} />
            {draft.enabled ? "Enabled" : "Disabled"}
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {canDelete ? (
          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={onDelete} loading={deleting}>
            <Trash className="size-3.5" />
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit} loading={busy}>
            {isEdit ? "Save schedule" : "Add schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
