import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTriggerResponse } from "@/hooks/access/cloud/workflows/types";
import { useWorkflowTriggerDrafts, type TriggerKind } from "@/hooks/workflows/workflows/use-workflow-trigger-drafts";
import { TriggerBadgeRow } from "./triggers/TriggerBadgeRow";
import { PollTriggerStatusRow } from "./triggers/PollTriggerStatus";
import { TriggerForm } from "./triggers/TriggerForm";

/** Re-exported so fixtures can build trigger data without importing access paths. */
export type { WorkflowTriggerResponse };
export type { TriggerKind };

/** D16: a repo the trigger can pin ("owner/name"). The server derives + owns the
 * cloud workspace from it; the definition never names a workspace. */
export interface WorkflowTriggerRepoOption {
  fullName: string;
  label: string;
}

export interface WorkflowTriggersCardProps {
  workflowId: string;
  /** The workflow's declared args — a scheduled/poll run fires with fixed/mapped values. */
  args: readonly WorkflowInputSpec[];
  /** D16: the cloud repos the owner can pin (the server derives the warm
   * workspace from the pin). Poll runs are cloud-only in v1. */
  repoOptions: readonly WorkflowTriggerRepoOption[];
  /** D-028①: the desktop's local clones a SCHEDULE trigger may pin instead
   * (`targetMode: "local"`, 2a). Poll triggers never offer this list — the
   * poller lane has no claim/missed-run protocol for local yet. */
  localRepoOptions: readonly WorkflowTriggerRepoOption[];
  /** Deep-link a poll item's spawned run (spec 8.2 row B). Omit to hide the link. */
  onOpenRun?: (runId: string) => void;
}

/**
 * Triggers card (spec 3.5/3.6, Ona parity; poll config spec 1.3/4.2/8.2 row B).
 * Manual is an always-on chip; schedule + poll triggers render as quiet chips
 * (summary + status) in the same badge row, with `Webhook`/`API` shown as
 * disabled "soon" chips. Clicking a trigger chip (or an `+ Add` button) opens
 * the inline editor for that kind. Poll runs are cloud-only in v1 (the picker
 * offers cloud workspaces); schedule runs may additionally target "On this
 * Mac" (D-028①, 2a) when the desktop has a local clone of a repo. Poll
 * triggers additionally surface `last_poll_at`/`last_poll_error` and an
 * expandable per-item seen-set (spawned/invalid/error).
 */
export function WorkflowTriggersCard({
  workflowId,
  args,
  repoOptions,
  localRepoOptions,
  onOpenRun,
}: WorkflowTriggersCardProps) {
  const {
    triggers,
    pollTriggers,
    cloudAvailable,
    localAvailable,
    scheduleAddDisabled,
    pollAddDisabled,
    editing,
    draft,
    error,
    errorMismatches,
    busy,
    deleting,
    openForm,
    closeForm,
    patchDraft,
    submit,
    removeTrigger,
  } = useWorkflowTriggerDrafts(workflowId, args, repoOptions, localRepoOptions);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-sm">
      <span className="text-sm font-medium text-foreground">Triggers</span>

      <TriggerBadgeRow
        triggers={triggers}
        activeId={editing?.id ?? undefined}
        addingKind={editing !== null && editing.id === null ? draft?.kind ?? null : null}
        scheduleAddDisabled={scheduleAddDisabled}
        pollAddDisabled={pollAddDisabled}
        onAdd={(kind) => openForm(null, kind)}
        onEditTrigger={(trigger) => openForm(trigger)}
      />

      {!cloudAvailable && !localAvailable ? (
        <p className="text-xs text-faint">
          Configure a cloud repository or open a local repo to trigger this workflow that way; run
          it manually for now.
        </p>
      ) : !cloudAvailable ? (
        <p className="text-xs text-faint">
          Runs manually from here or the runs list; schedules can run on this Mac — polls need a
          cloud repository.
        </p>
      ) : (
        <p className="text-xs text-faint">
          Runs manually from here or the runs list; schedules can run on this Mac or in the cloud —
          polls fire in the cloud.
        </p>
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
          repoOptions={repoOptions}
          localRepoOptions={localRepoOptions}
          error={error}
          errorMismatches={errorMismatches}
          busy={busy}
          isEdit={editing.id !== null}
          canDelete={editing.id !== null}
          deleting={deleting}
          onPatch={patchDraft}
          onSubmit={submit}
          onCancel={closeForm}
          onDelete={removeTrigger}
        />
      ) : null}
    </div>
  );
}
