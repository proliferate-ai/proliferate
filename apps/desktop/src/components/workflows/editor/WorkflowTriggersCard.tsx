import { useMemo, useState } from "react";
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
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Plus } from "@proliferate/ui/icons";

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

interface TriggerDraft {
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
 * Triggers card (spec 3.5/3.6). Manual is always-on; `+ Add schedule` opens the
 * inline schedule editor (reusing the automations RRULE popover). Scheduled runs
 * are cloud-only in v1 — the picker offers cloud workspaces and the card explains
 * when none exist. Concurrency (`skip | queue`), enable/disable, next-run, and the
 * last-skip reason are all persisted per trigger.
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

  const toggleEnabled = (trigger: WorkflowTriggerResponse, enabled: boolean) => {
    updateMutation.mutate({ triggerId: trigger.id, body: { enabled } });
  };

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4">
      <span className="text-ui-sm font-medium text-foreground">Triggers</span>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent px-2.5 py-1 text-xs text-foreground">
          <span aria-hidden>▶</span> Manual
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!cloudAvailable || editing !== null}
          title={cloudAvailable ? undefined : "Scheduled runs need a cloud workspace"}
          onClick={() => openForm(null)}
        >
          <Plus className="size-3.5" />
          Add schedule
        </Button>
        <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
          Webhook · soon
        </span>
        <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
          API · soon
        </span>
      </div>

      {!cloudAvailable ? (
        <p className="text-xs text-faint">
          Scheduled runs execute in the cloud. Create a cloud workspace to schedule this workflow;
          local schedules are coming — run it manually for now.
        </p>
      ) : null}

      {triggers.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {triggers.map((trigger) => (
            <TriggerRow
              key={trigger.id}
              trigger={trigger}
              cloudWorkspaces={cloudWorkspaces}
              onEdit={() => openForm(trigger)}
              onDelete={() => deleteMutation.mutate(trigger.id)}
              onToggle={(enabled) => toggleEnabled(trigger, enabled)}
              busy={updateMutation.isPending || deleteMutation.isPending}
            />
          ))}
        </ul>
      ) : null}

      {editing && draft ? (
        <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-card/50 p-3">
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Schedule</Label>
            <AutomationSchedulePopover
              schedulePreset={draft.preset}
              rrule={draft.rrule}
              timezone={draft.timezone}
              onSchedulePresetChange={(preset) => patchDraft({ preset })}
              onRruleChange={(rrule) => patchDraft({ rrule })}
              onTimezoneChange={(timezone) => patchDraft({ timezone })}
              onRruleBlur={() => patchDraft({ preset: presetForRrule(draft.rrule) })}
            />
            <span className="text-xs text-faint">
              Fires at {timeForRrule(draft.rrule)} · {draft.timezone}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Cloud workspace</Label>
            <Select
              value={draft.workspaceId}
              onChange={(event) => patchDraft({ workspaceId: event.target.value })}
            >
              {cloudWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label}
                </option>
              ))}
            </Select>
          </div>

          {args.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
              <Label className="text-xs">Arguments</Label>
              {args.map((arg) => (
                <div key={arg.name} className="flex flex-col gap-1">
                  <Label className="flex items-center gap-1 text-xs font-normal">
                    {arg.name}
                    {arg.required ? <span className="text-destructive">*</span> : null}
                    <span className="text-faint">· {arg.type}</span>
                  </Label>
                  {arg.type === "boolean" ? (
                    <Switch
                      checked={Boolean(draft.argValues[arg.name])}
                      onChange={(checked) =>
                        patchDraft({ argValues: { ...draft.argValues, [arg.name]: checked } })
                      }
                    />
                  ) : arg.type === "enum" ? (
                    <Select
                      value={String(draft.argValues[arg.name] ?? "")}
                      onChange={(event) =>
                        patchDraft({ argValues: { ...draft.argValues, [arg.name]: event.target.value } })
                      }
                    >
                      {(arg.enum ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={arg.type === "number" ? "number" : "text"}
                      value={String(draft.argValues[arg.name] ?? "")}
                      onChange={(event) =>
                        patchDraft({ argValues: { ...draft.argValues, [arg.name]: event.target.value } })
                      }
                      placeholder={arg.required ? "Required" : "Optional"}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-3 border-t border-border/60 pt-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">If still running when triggered again</Label>
              <Select
                value={draft.concurrency}
                className="w-40"
                onChange={(event) => patchDraft({ concurrency: event.target.value as Concurrency })}
              >
                <option value="skip">Skip</option>
                <option value="queue">Queue</option>
              </Select>
            </div>
            <label className="mb-1.5 flex items-center gap-2 text-xs text-foreground">
              <Switch checked={draft.enabled} onChange={(enabled) => patchDraft({ enabled })} />
              Enabled
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={closeForm}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} loading={busy}>
              {editing.id ? "Save schedule" : "Add schedule"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface TriggerRowProps {
  trigger: WorkflowTriggerResponse;
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  busy: boolean;
}

function TriggerRow({
  trigger,
  cloudWorkspaces,
  onEdit,
  onDelete,
  onToggle,
  busy,
}: TriggerRowProps) {
  const workspaceLabel = useMemo(
    () => cloudWorkspaces.find((w) => w.id === trigger.targetWorkspaceId)?.label ?? "cloud workspace",
    [cloudWorkspaces, trigger.targetWorkspaceId],
  );

  return (
    <li className="flex flex-col gap-1 rounded-[10px] border border-border bg-card/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ui-sm text-foreground">
            {trigger.schedule?.summary ?? "Schedule"}
          </span>
          <span className="truncate text-xs text-faint">
            {trigger.enabled
              ? `Next run ${formatAutomationTimestamp(trigger.nextRunAt ?? null, trigger.schedule?.timezone)}`
              : "Disabled"}
            {" · "}
            {workspaceLabel}
            {" · "}
            {trigger.concurrencyPolicy === "queue" ? "Queue" : "Skip"} when running
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch checked={trigger.enabled} onChange={onToggle} disabled={busy} />
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy}>
            Delete
          </Button>
        </div>
      </div>
      {trigger.lastSkipReason ? (
        <span className="text-xs text-warning">Last skipped: {trigger.lastSkipReason}</span>
      ) : null}
    </li>
  );
}
