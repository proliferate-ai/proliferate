import { PopoverButton } from "@/components/ui/PopoverButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AddPlan, ClipboardList, LoaderCircle } from "@/components/ui/icons";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { ComposerPopoverSurface } from "@/components/workspace/chat/input/ComposerPopoverSurface";
import { usePlanPicker } from "@/hooks/plans/use-plan-picker";
import {
  formatPlanAgentKindLabel,
  formatPlanDecisionStateLabel,
} from "@/lib/domain/plans/plan-presentation";
import { PLAN_PICKER_SEARCH_PLACEHOLDER } from "@/copy/plans/plan-picker-copy";

interface PlanPickerPopoverProps {
  workspaceUiKey: string | null;
  sdkWorkspaceId: string | null;
  disabled?: boolean;
}

export function PlanPickerPopover({
  workspaceUiKey,
  sdkWorkspaceId,
  disabled = false,
}: PlanPickerPopoverProps) {
  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          iconOnly
          disabled={disabled}
          icon={<AddPlan className="size-4" />}
          label="Attach plan"
          title={disabled ? "Select a workspace before attaching a plan" : "Attach plan"}
          aria-label="Attach plan"
        />
      )}
      align="end"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <PlanPickerPopoverSurface
          workspaceUiKey={workspaceUiKey}
          sdkWorkspaceId={sdkWorkspaceId}
          onClose={close}
        />
      )}
    </PopoverButton>
  );
}

export function PlanPickerPopoverSurface({
  workspaceUiKey,
  sdkWorkspaceId,
  onClose,
}: {
  workspaceUiKey: string | null;
  sdkWorkspaceId: string | null;
  onClose: () => void;
}) {
  return (
    <ComposerPopoverSurface className="w-[min(24rem,calc(100vw-2rem))] p-0" data-telemetry-mask>
      <PlanPickerContentBody
        workspaceUiKey={workspaceUiKey}
        sdkWorkspaceId={sdkWorkspaceId}
        onClose={onClose}
      />
    </ComposerPopoverSurface>
  );
}

export function PlanPickerContentBody({
  workspaceUiKey,
  sdkWorkspaceId,
  onClose,
}: {
  workspaceUiKey: string | null;
  sdkWorkspaceId: string | null;
  onClose: () => void;
}) {
  const picker = usePlanPicker({ workspaceUiKey, sdkWorkspaceId, open: true, onAttached: onClose });

  return (
    <div data-telemetry-mask>
      <div className="border-b border-border px-2 pb-2 pt-2">
        <Input
          value={picker.search}
          onChange={(event) => picker.setSearch(event.target.value)}
          placeholder={PLAN_PICKER_SEARCH_PLACEHOLDER}
          className="h-8"
          autoFocus
        />
      </div>
      <div className="max-h-80 overflow-y-auto p-1">
        {picker.isLoading && (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading plans...
          </div>
        )}
        {!picker.isLoading && picker.isError && (
          <div className="px-3 py-4 text-sm text-destructive">
            Failed to load plans.
          </div>
        )}
        {!picker.isLoading && !picker.isError && picker.plans.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            No plans found.
          </div>
        )}
        {picker.plans.map((plan) => (
          <Button
            key={plan.id}
            type="button"
            variant="ghost"
            size="sm"
            disabled={picker.attachingPlanId !== null}
            onClick={() => picker.attachPlan(plan.id)}
            className="h-auto w-full justify-start rounded-lg px-2 py-2 text-left"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <ClipboardList className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {plan.title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatPlanAgentKindLabel(plan.sourceAgentKind)}
                {" - "}
                {formatPlanDecisionStateLabel(plan.decisionState)}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
