import { useState } from "react";
import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
// v2 (D17): args → inputs; the card consumes the workflow's declared inputs.
import type {
  WorkflowTriggerCreateRequest,
  WorkflowTriggerItemResponse,
  WorkflowTriggerResponse,
} from "@/lib/access/cloud/workflows";
import {
  useWorkflowTriggers,
  useWorkflowTriggerMutations,
} from "@/hooks/access/cloud/workflows/use-workflow-triggers";
import { useWorkflowTriggerItems } from "@/hooks/access/cloud/workflows/use-workflow-trigger-items";
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
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { ArrowUpRight, ChevronDown, ChevronRight, CircleAlert, Clock, Play, Plus, RefreshCw, Trash } from "@proliferate/ui/icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { WorkflowSelect } from "./WorkflowSelect";

/** Re-exported so fixtures can build trigger data without importing access paths. */
export type { WorkflowTriggerResponse };

type ArgValue = string | number | boolean;
type Concurrency = "skip" | "queue";
export type TriggerKind = "schedule" | "poll";

export interface WorkflowTriggersCardProps {
  workflowId: string;
  /** The workflow's declared args — a scheduled/poll run fires with fixed/mapped values. */
  args: readonly WorkflowInputSpec[];
  /** The owner's ready cloud workspaces (schedule + poll runs are cloud-only in v1). */
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  /** Deep-link a poll item's spawned run (spec 8.2 row B). Omit to hide the link. */
  onOpenRun?: (runId: string) => void;
}

const DEFAULT_RRULE = "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0";
// Mirrors WORKFLOW_POLL_MIN_INTERVAL_SECONDS (server/proliferate/constants/workflows.py).
const POLL_MIN_INTERVAL_SECS = 60;

function initialArgValue(arg: WorkflowInputSpec): ArgValue {
  if (arg.default !== undefined) return arg.default;
  switch (arg.type) {
    case "boolean":
      return false;
    case "choice":
      return arg.choices?.[0] ?? "";
    default:
      return "";
  }
}

export interface TriggerDraft {
  kind: TriggerKind;
  // schedule fields
  rrule: string;
  timezone: string;
  preset: AutomationSchedulePresetOrCustom;
  // poll fields
  pollUrl: string;
  pollAuthHeader: string;
  /** Whether the stored trigger already has an encrypted secret (server-reported). */
  pollHasAuth: boolean;
  /** True once the user opts to type a new secret over an existing one. */
  pollReplaceAuth: boolean;
  pollAuthValue: string;
  pollIntervalSecs: number;
  // The poll item schema is DERIVED server-side from the workflow inputs (D17):
  // no item-schema or args-mapping authoring surface here.
  // common
  concurrency: Concurrency;
  enabled: boolean;
  workspaceId: string;
  argValues: Record<string, ArgValue>;
}

function draftFromTrigger(
  trigger: WorkflowTriggerResponse | null,
  args: readonly WorkflowInputSpec[],
  cloudWorkspaces: readonly WorkflowRunTargetOption[],
  fallbackKind: TriggerKind,
): TriggerDraft {
  const kind: TriggerKind = (trigger?.kind as TriggerKind | undefined) ?? fallbackKind;
  const rrule = trigger?.schedule?.rrule ?? DEFAULT_RRULE;
  const argValues: Record<string, ArgValue> = {};
  for (const arg of args) {
    const stored = trigger?.args?.[arg.name] as ArgValue | undefined;
    argValues[arg.name] = stored ?? initialArgValue(arg);
  }
  return {
    kind,
    rrule,
    timezone: trigger?.schedule?.timezone ?? defaultAutomationTimezone(),
    preset: presetForRrule(rrule),
    pollUrl: trigger?.poll?.url ?? "",
    pollAuthHeader: trigger?.poll?.authHeader ?? "",
    pollHasAuth: trigger?.poll?.hasAuth ?? false,
    pollReplaceAuth: !(trigger?.poll?.hasAuth ?? false),
    pollAuthValue: "",
    pollIntervalSecs: trigger?.poll?.intervalSecs ?? POLL_MIN_INTERVAL_SECS,
    concurrency: (trigger?.concurrencyPolicy as Concurrency) ?? "skip",
    enabled: trigger?.enabled ?? true,
    workspaceId: trigger?.targetWorkspaceId ?? cloudWorkspaces[0]?.id ?? "",
    argValues,
  };
}

function coerceArg(arg: WorkflowInputSpec, value: ArgValue): ArgValue {
  if (arg.type === "number") return value === "" ? "" : Number(value);
  return value;
}

/**
 * Triggers card (spec 3.5/3.6, Ona parity; poll config spec 1.3/4.2/8.2 row B).
 * Manual is an always-on chip; schedule + poll triggers render as quiet chips
 * (summary + status) in the same badge row, with `Webhook`/`API` shown as
 * disabled "soon" chips. Clicking a trigger chip (or an `+ Add` button) opens
 * the inline editor for that kind. Both trigger kinds are cloud-only in v1 —
 * the picker offers cloud workspaces and the card explains when none exist.
 * Poll triggers additionally surface `last_poll_at`/`last_poll_error` and an
 * expandable per-item seen-set (spawned/invalid/error).
 */
export function WorkflowTriggersCard({
  workflowId,
  args,
  cloudWorkspaces,
  onOpenRun,
}: WorkflowTriggersCardProps) {
  const triggersQuery = useWorkflowTriggers(workflowId);
  const { createMutation, updateMutation, deleteMutation } =
    useWorkflowTriggerMutations(workflowId);

  const triggers = triggersQuery.data ?? [];
  const pollTriggers = triggers.filter((t) => t.kind === "poll");
  const cloudAvailable = cloudWorkspaces.length > 0;

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [draft, setDraft] = useState<TriggerDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openForm = (trigger: WorkflowTriggerResponse | null, kind: TriggerKind = "schedule") => {
    setError(null);
    setEditing({ id: trigger?.id ?? null });
    setDraft(draftFromTrigger(trigger, args, cloudWorkspaces, kind));
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
      setError(`Choose a cloud workspace for the ${draft.kind === "poll" ? "polled" : "scheduled"} run.`);
      return;
    }

    if (draft.kind === "poll") {
      const url = draft.pollUrl.trim();
      if (!url || !(url.startsWith("http://") || url.startsWith("https://"))) {
        setError("Enter a valid poll URL (http:// or https://).");
        return;
      }
      if (draft.pollIntervalSecs < POLL_MIN_INTERVAL_SECS) {
        setError(`Poll interval must be at least ${POLL_MIN_INTERVAL_SECS} seconds.`);
        return;
      }
      const authHeader = draft.pollAuthHeader.trim();
      const isCreate = editing?.id === null;
      if (authHeader && !draft.pollAuthValue && (isCreate || draft.pollReplaceAuth)) {
        setError("Provide a value for the auth header, or leave the header name blank.");
        return;
      }
      // Required inputs not supplied as a static preset are expected to arrive
      // per-item in the poll item's `data` (matched by name, D17), so there is no
      // author-time "required arg" gate for poll triggers.
      const staticArgs: Record<string, ArgValue> = {};
      for (const arg of args) {
        const value = coerceArg(arg, draft.argValues[arg.name] ?? "");
        if (value !== "") staticArgs[arg.name] = value;
      }

      const body: WorkflowTriggerCreateRequest = {
        kind: "poll",
        enabled: draft.enabled,
        concurrencyPolicy: draft.concurrency,
        targetMode: "personal_cloud",
        targetWorkspaceId: draft.workspaceId,
        poll: {
          url,
          authHeader: authHeader || null,
          authValue:
            !authHeader || (!isCreate && !draft.pollReplaceAuth)
              ? undefined
              : draft.pollAuthValue,
          intervalSecs: draft.pollIntervalSecs,
        },
        args: staticArgs,
      };
      const onDone = { onSuccess: closeForm, onError: (e: Error) => setError(e.message) };
      if (editing?.id) {
        updateMutation.mutate({ triggerId: editing.id, body }, onDone);
      } else {
        createMutation.mutate(body, onDone);
      }
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
        addingKind={editing !== null && editing.id === null ? draft?.kind ?? null : null}
        addDisabled={!cloudAvailable}
        onAdd={(kind) => openForm(null, kind)}
        onEditTrigger={(trigger) => openForm(trigger)}
      />

      {!cloudAvailable ? (
        <p className="text-xs text-faint">
          Scheduled and poll runs execute in the cloud. Create a cloud workspace to trigger this
          workflow that way; local triggers are coming — run it manually for now.
        </p>
      ) : (
        <p className="text-xs text-faint">Runs manually from here or the runs list; schedules and polls fire in the cloud.</p>
      )}

      {pollTriggers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {pollTriggers.map((trigger) => (
            <PollTriggerStatusRow key={trigger.id} trigger={trigger} onOpenRun={onOpenRun} />
          ))}
        </div>
      ) : null}

      {editing && draft ? (
        <TriggerForm
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
  /** The kind currently being added via the inline "+ Add" form, if any. */
  addingKind: TriggerKind | null;
  addDisabled: boolean;
  onAdd: (kind: TriggerKind) => void;
  onEditTrigger: (trigger: WorkflowTriggerResponse) => void;
}

/** The Ona-style chip row: Manual + schedule/poll chips + disabled "soon" chips + add buttons. */
export function TriggerBadgeRow({
  triggers,
  cloudWorkspaces,
  activeId,
  addingKind,
  addDisabled,
  onAdd,
  onEditTrigger,
}: TriggerBadgeRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent px-2.5 py-1 text-sm text-foreground">
        <Play className="size-3.5" aria-hidden />
        Manual
      </span>

      {triggers.map((trigger) => (
        <TriggerChip
          key={trigger.id}
          trigger={trigger}
          workspaceLabel={
            cloudWorkspaces.find((w) => w.id === trigger.targetWorkspaceId)?.label ?? "cloud workspace"
          }
          active={trigger.id === activeId}
          onClick={() => onEditTrigger(trigger)}
        />
      ))}

      <AddTriggerButton
        label="Add schedule"
        active={addingKind === "schedule"}
        disabled={addDisabled}
        onClick={() => onAdd("schedule")}
      />
      <AddTriggerButton
        label="Add poll"
        active={addingKind === "poll"}
        disabled={addDisabled}
        onClick={() => onAdd("poll")}
      />

      <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
        Webhook · soon
      </span>
      <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-faint">
        API · soon
      </span>
    </div>
  );
}

function AddTriggerButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Scheduled and poll runs need a cloud workspace" : undefined}
      onClick={onClick}
      className={twMerge(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:border-border-heavy hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground",
        active ? "border-solid border-border-heavy text-foreground" : "",
      )}
    >
      <Plus className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

function TriggerChip({
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
  const isPoll = trigger.kind === "poll";
  const summary = isPoll
    ? `Poll · every ${Math.round((trigger.poll?.intervalSecs ?? POLL_MIN_INTERVAL_SECS) / 60)}m`
    : trigger.schedule?.summary ?? "Schedule";
  const nextRun = trigger.enabled && !isPoll
    ? formatAutomationTimestamp(trigger.nextRunAt ?? null, trigger.schedule?.timezone)
    : null;
  const title = isPoll
    ? `${workspaceLabel}${trigger.poll?.lastPollError ? ` · last error: ${trigger.poll.lastPollError}` : ""}`
    : `${workspaceLabel}${trigger.lastSkipReason ? ` · last skipped: ${trigger.lastSkipReason}` : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={twMerge(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors",
        active ? "border-border-heavy bg-list-hover text-foreground" : "border-border bg-accent text-foreground hover:border-border-heavy",
        trigger.enabled ? "" : "opacity-55",
      )}
    >
      {isPoll ? (
        <RefreshCw className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="truncate">{summary}</span>
      {isPoll ? (
        trigger.enabled ? (
          trigger.poll?.lastPollError ? (
            <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
          ) : null
        ) : (
          <span className="text-xs text-faint">· off</span>
        )
      ) : (
        <span className="text-xs text-faint">{trigger.enabled ? (nextRun ? `· ${nextRun}` : "") : "· off"}</span>
      )}
    </button>
  );
}

function PollTriggerStatusRow({
  trigger,
  onOpenRun,
}: {
  trigger: WorkflowTriggerResponse;
  onOpenRun?: (runId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const itemsQuery = useWorkflowTriggerItems(trigger.workflowId, trigger.id, expanded);
  const poll = trigger.poll;
  if (!poll) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface-elevated-secondary/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate font-mono">{poll.url}</span>
          <span className="shrink-0 text-faint">
            · {poll.lastPollAt ? `last polled ${formatAutomationTimestamp(poll.lastPollAt)}` : "not polled yet"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-list-hover hover:text-foreground"
        >
          {expanded ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          Items
        </button>
      </div>

      {poll.lastPollError ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {poll.lastPollError}
        </p>
      ) : null}

      {expanded ? (
        <TriggerItemsList
          items={itemsQuery.data ?? []}
          loading={itemsQuery.isPending}
          onOpenRun={onOpenRun}
        />
      ) : null}
    </div>
  );
}

const ITEM_STATUS_TONE: Record<string, BadgeTone> = {
  spawned: "success",
  invalid: "warning",
  error: "destructive",
};

function TriggerItemsList({
  items,
  loading,
  onOpenRun,
}: {
  items: readonly WorkflowTriggerItemResponse[];
  loading: boolean;
  onOpenRun?: (runId: string) => void;
}) {
  if (loading) {
    return <p className="px-1 py-1 text-xs text-faint">Loading items…</p>;
  }
  if (items.length === 0) {
    return <p className="px-1 py-1 text-xs text-faint">No items seen yet.</p>;
  }
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-1.5">
      {items.map((item) => (
        <div key={item.itemId} className="flex items-start justify-between gap-2 px-1 py-0.5 text-xs">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <Badge tone={ITEM_STATUS_TONE[item.status] ?? "neutral"} className="text-[11px]">
                {item.status}
              </Badge>
              <span className="min-w-0 truncate font-mono text-faint">{item.itemId}</span>
              <span className="shrink-0 text-faint">· {formatAutomationTimestamp(item.receivedAt)}</span>
            </div>
            {item.errorMessage ? <p className="text-destructive">{item.errorMessage}</p> : null}
          </div>
          {item.status === "spawned" && item.runId && onOpenRun ? (
            <button
              type="button"
              onClick={() => onOpenRun(item.runId!)}
              className="flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              Open run
              <ArrowUpRight className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface TriggerFormProps {
  draft: TriggerDraft;
  args: readonly WorkflowInputSpec[];
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

/** The inline trigger editor — shared form rhythm, aligned rows, one size. Renders
 * the schedule or poll field group depending on `draft.kind`. */
export function TriggerForm({
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
}: TriggerFormProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-elevated-secondary/40 p-3">
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {draft.kind === "poll" ? (
        <PollFields draft={draft} cloudWorkspaces={cloudWorkspaces} isEdit={isEdit} onPatch={onPatch} />
      ) : (
        <ScheduleFields draft={draft} cloudWorkspaces={cloudWorkspaces} onPatch={onPatch} />
      )}

      {args.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <Label className="mb-0">{draft.kind === "poll" ? "Input presets" : "Arguments"}</Label>
          {draft.kind === "poll" ? (
            <p className="text-xs text-faint">
              Optional static presets. Any input a poll item&apos;s data supplies (by name)
              overrides its preset.
            </p>
          ) : null}
          {args.map((arg) => (
            <ScheduleArgRow key={arg.name} arg={arg} draft={draft} onPatch={onPatch} />
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
            {isEdit ? "Save trigger" : draft.kind === "poll" ? "Add poll" : "Add schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScheduleFields({
  draft,
  cloudWorkspaces,
  onPatch,
}: {
  draft: TriggerDraft;
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  onPatch: (patch: Partial<TriggerDraft>) => void;
}) {
  return (
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
  );
}

function PollFields({
  draft,
  cloudWorkspaces,
  isEdit,
  onPatch,
}: {
  draft: TriggerDraft;
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  isEdit: boolean;
  onPatch: (patch: Partial<TriggerDraft>) => void;
}) {
  const showAuthValueInput = draft.pollReplaceAuth || !isEdit;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Poll URL</Label>
          <Input
            type="url"
            value={draft.pollUrl}
            onChange={(event) => onPatch({ pollUrl: event.target.value })}
            placeholder="https://issues.example.com/poll"
          />
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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Auth header name</Label>
          <Input
            value={draft.pollAuthHeader}
            onChange={(event) => onPatch({ pollAuthHeader: event.target.value })}
            placeholder="Authorization"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Auth header value</Label>
          {showAuthValueInput ? (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={draft.pollAuthValue}
                onChange={(event) => onPatch({ pollAuthValue: event.target.value })}
                placeholder={draft.pollAuthHeader ? "Header value" : "No auth header set"}
                disabled={!draft.pollAuthHeader.trim()}
              />
              {draft.pollHasAuth ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPatch({ pollReplaceAuth: false, pollAuthValue: "" })}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-elevated-secondary px-3 text-sm text-muted-foreground">
              <span className="flex-1 truncate">Configured — value hidden</span>
              <Button variant="ghost" size="sm" onClick={() => onPatch({ pollReplaceAuth: true })}>
                Replace
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label>Poll interval (seconds)</Label>
        <Input
          type="number"
          min={POLL_MIN_INTERVAL_SECS}
          value={draft.pollIntervalSecs}
          onChange={(event) => onPatch({ pollIntervalSecs: Number(event.target.value) || 0 })}
        />
        <span className="text-xs text-faint">Minimum {POLL_MIN_INTERVAL_SECS} seconds.</span>
      </div>

      <p className="text-xs text-faint">
        The endpoint&apos;s items must return a <code>data</code> object whose fields match this
        workflow&apos;s inputs by name and type — verified once when you save.
      </p>
    </div>
  );
}

function ScheduleArgRow({
  arg,
  draft,
  onPatch,
}: {
  arg: WorkflowInputSpec;
  draft: TriggerDraft;
  onPatch: (patch: Partial<TriggerDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-2">
      <span className="flex min-w-0 items-center gap-1 truncate font-mono text-sm text-foreground">
        {arg.name}
        {arg.required ? <span className="text-destructive">*</span> : null}
        <span className="font-sans text-xs text-faint">· {arg.type}</span>
      </span>
      <ArgValueInput arg={arg} value={draft.argValues[arg.name]} onChange={(value) => onPatch({ argValues: { ...draft.argValues, [arg.name]: value } })} />
    </div>
  );
}

function ArgValueInput({
  arg,
  value,
  onChange,
}: {
  arg: WorkflowInputSpec;
  value: ArgValue;
  onChange: (value: ArgValue) => void;
}) {
  if (arg.type === "boolean") {
    return (
      <div className="flex h-9 items-center">
        <Switch checked={Boolean(value)} onChange={(checked) => onChange(checked)} />
      </div>
    );
  }
  if (arg.type === "choice") {
    return (
      <WorkflowSelect
        ariaLabel={`${arg.name} value`}
        value={String(value ?? "")}
        options={(arg.choices ?? []).map((option) => ({ value: option, label: option }))}
        onChange={(next) => onChange(next)}
      />
    );
  }
  return (
    <Input
      type={arg.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
      placeholder={arg.required ? "Required" : "Optional"}
    />
  );
}
