import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import type { PollFieldMismatch } from "@proliferate/product-domain/workflows/poll-setup";
import { Button } from "@proliferate/ui/primitives/Button";
import { Label } from "@proliferate/ui/primitives/Label";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Trash } from "@proliferate/ui/icons";
import type {
  Concurrency,
  MissedRunPolicy,
  TriggerDraft,
} from "@/hooks/workflows/workflows/use-workflow-trigger-drafts";
import { WorkflowSelect } from "../WorkflowSelect";
import type { WorkflowTriggerRepoOption } from "../WorkflowTriggersCard";
import { PollFields } from "./PollFields";
import { ScheduleFields } from "./ScheduleFields";
import { ScheduleArgRow } from "./TriggerArgRow";

// The heading that precedes the structured diff in the server's
// poll_signature_mismatch message (service.py _probe_poll_signature):
// "Poll item '<id>' does not match the workflow's declared inputs:". Used only
// to label the list below — the list itself renders `errorMismatches`
// (mental-model §5 flow 2: "render exactly how their response doesn't track —
// field-by-field diff"), not a re-split of this message.
const POLL_SIGNATURE_HEADING_RE = /^(Poll item '.*?' does not match the workflow's declared inputs:)/;

function PollSetupError({
  error,
  mismatches,
}: {
  error: string;
  mismatches: readonly PollFieldMismatch[] | null;
}) {
  if (!mismatches || mismatches.length === 0) {
    // Save-time errors with no field diff (timeouts, poll_probe_failed, plain
    // validation messages) — the structured message from the backend, verbatim.
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
        {error}
      </p>
    );
  }
  const heading = error.match(POLL_SIGNATURE_HEADING_RE)?.[1] ?? error;
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
      <p>{heading}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {mismatches.map((mismatch, index) => (
          <li key={index}>
            {mismatch.field ? <span className="font-mono">{mismatch.field}</span> : null}
            {mismatch.field ? " — " : ""}
            {mismatch.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface TriggerFormProps {
  draft: TriggerDraft;
  args: readonly WorkflowInputSpec[];
  repoOptions: readonly WorkflowTriggerRepoOption[];
  localRepoOptions: readonly WorkflowTriggerRepoOption[];
  error: string | null;
  /** Flow 2's structured field-by-field diff (poll_signature_mismatch's
   * `extra_detail.mismatches`), if `error` is that kind of failure. */
  errorMismatches: readonly PollFieldMismatch[] | null;
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
  repoOptions,
  localRepoOptions,
  error,
  errorMismatches,
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
      {error ? <PollSetupError error={error} mismatches={errorMismatches} /> : null}

      {draft.kind === "poll" ? (
        <PollFields draft={draft} repoOptions={repoOptions} isEdit={isEdit} onPatch={onPatch} />
      ) : (
        <ScheduleFields
          draft={draft}
          repoOptions={repoOptions}
          localRepoOptions={localRepoOptions}
          onPatch={onPatch}
        />
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

      {draft.kind === "schedule" ? (
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <Label>If a run was missed while offline</Label>
          <WorkflowSelect
            ariaLabel="Missed-run policy"
            value={draft.missedRunPolicy}
            options={[
              { value: "run_latest", label: "Run the latest occurrence, skip older ones" },
              { value: "skip_all", label: "Skip every missed occurrence" },
              { value: "replay_all", label: "Replay every missed occurrence" },
            ]}
            onChange={(value) => onPatch({ missedRunPolicy: value as MissedRunPolicy })}
          />
          <span className="text-xs text-faint">
            Applies when the scheduler was down and this trigger came due more than once. Every
            occurrence — fired or not — is kept in the run history below.
          </span>
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
          <Label className="mb-0 flex h-9 items-center gap-2 text-sm text-foreground">
            <Switch checked={draft.enabled} onChange={(enabled) => onPatch({ enabled })} />
            {draft.enabled ? "Enabled" : "Disabled"}
          </Label>
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
