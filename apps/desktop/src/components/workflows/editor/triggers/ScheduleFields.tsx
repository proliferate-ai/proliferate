import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import { Label } from "@proliferate/ui/primitives/Label";
import { AutomationSchedulePopover } from "@/components/automations/editor/AutomationEditorControls";
import { presetForRrule, timeForRrule } from "@/lib/domain/automations/schedule/schedule";
import type { TriggerDraft } from "@/hooks/workflows/workflows/use-workflow-trigger-drafts";
import { WorkflowSelect } from "../WorkflowSelect";
import type { WorkflowTriggerRepoOption } from "../WorkflowTriggersCard";

export function ScheduleFields({
  draft,
  repoOptions,
  localRepoOptions,
  onPatch,
}: {
  draft: TriggerDraft;
  repoOptions: readonly WorkflowTriggerRepoOption[];
  localRepoOptions: readonly WorkflowTriggerRepoOption[];
  onPatch: (patch: Partial<TriggerDraft>) => void;
}) {
  const cloudAvailable = repoOptions.length > 0;
  const localAvailable = localRepoOptions.length > 0;
  const activeRepoOptions = draft.targetMode === "local" ? localRepoOptions : repoOptions;

  // D-028①: only offer a location that actually has a repo to pin. Switching
  // location re-seeds the repo pin from the newly active list (never carries
  // a stale cross-lane value).
  const setTargetMode = (targetMode: WorkflowTargetMode) => {
    const nextOptions = targetMode === "local" ? localRepoOptions : repoOptions;
    onPatch({ targetMode, repoFullName: nextOptions[0]?.fullName ?? "" });
  };

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
        <Label>Location</Label>
        <WorkflowSelect
          ariaLabel="Run location"
          value={draft.targetMode}
          options={[
            ...(localAvailable ? [{ value: "local", label: "On this Mac" }] : []),
            ...(cloudAvailable ? [{ value: "personal_cloud", label: "Cloud" }] : []),
          ]}
          onChange={(value) => setTargetMode(value as WorkflowTargetMode)}
        />
      </div>
      <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
        <Label>Repository</Label>
        {activeRepoOptions.length > 0 ? (
          <WorkflowSelect
            ariaLabel="Repository"
            value={draft.repoFullName}
            options={activeRepoOptions.map((repo) => ({ value: repo.fullName, label: repo.label }))}
            onChange={(value) => onPatch({ repoFullName: value })}
          />
        ) : (
          <p className="text-xs text-faint">
            {draft.targetMode === "local"
              ? "No local repository clones found on this device."
              : "No cloud repositories yet."}
          </p>
        )}
      </div>
    </div>
  );
}
