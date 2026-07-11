import { Button } from "@proliferate/ui/primitives/Button";
import { CircleAlert, Clock, Play, Plus, RefreshCw } from "@proliferate/ui/icons";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { formatAutomationTimestamp } from "@/lib/domain/automations/schedule/schedule";
import type { WorkflowTriggerResponse } from "@/hooks/access/cloud/workflows/types";
import type { TriggerKind } from "@/hooks/workflows/workflows/use-workflow-trigger-drafts";

// Mirrors WORKFLOW_POLL_MIN_INTERVAL_SECONDS (server/proliferate/constants/workflows.py).
const POLL_MIN_INTERVAL_SECS = 60;

export interface TriggerBadgeRowProps {
  triggers: readonly WorkflowTriggerResponse[];
  activeId?: string | null;
  /** The kind currently being added via the inline "+ Add" form, if any. */
  addingKind: TriggerKind | null;
  /** Schedule may target cloud OR local (D-028①) — disabled only when neither exists. */
  scheduleAddDisabled: boolean;
  /** Poll stays cloud-only — disabled when no cloud repo exists. */
  pollAddDisabled: boolean;
  onAdd: (kind: TriggerKind) => void;
  onEditTrigger: (trigger: WorkflowTriggerResponse) => void;
}

/** The Ona-style chip row: Manual + schedule/poll chips + disabled "soon" chips + add buttons. */
export function TriggerBadgeRow({
  triggers,
  activeId,
  addingKind,
  scheduleAddDisabled,
  pollAddDisabled,
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
          repoLabel={trigger.repoFullName ?? (trigger.targetMode === "local" ? "this Mac" : "cloud repository")}
          active={trigger.id === activeId}
          onClick={() => onEditTrigger(trigger)}
        />
      ))}

      <AddTriggerButton
        label="Add schedule"
        active={addingKind === "schedule"}
        disabled={scheduleAddDisabled}
        disabledTitle="Scheduled runs need a cloud repository or a local clone"
        onClick={() => onAdd("schedule")}
      />
      <AddTriggerButton
        label="Add poll"
        active={addingKind === "poll"}
        disabled={pollAddDisabled}
        disabledTitle="Poll runs need a cloud workspace"
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
  disabledTitle,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  disabledTitle: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      onClick={onClick}
      className={twMerge(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:border-border-heavy hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground",
        active ? "border-solid border-border-heavy text-foreground" : "",
      )}
    >
      <Plus className="size-3.5" aria-hidden />
      {label}
    </Button>
  );
}

function TriggerChip({
  trigger,
  repoLabel,
  active,
  onClick,
}: {
  trigger: WorkflowTriggerResponse;
  repoLabel: string;
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
    ? `${repoLabel}${trigger.poll?.lastPollError ? ` · last error: ${trigger.poll.lastPollError}` : ""}`
    : `${repoLabel}${trigger.lastSkipReason ? ` · last skipped: ${trigger.lastSkipReason}` : ""}`;
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
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
    </Button>
  );
}
