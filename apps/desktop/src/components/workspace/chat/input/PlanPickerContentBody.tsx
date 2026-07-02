import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ClipboardList, Spinner } from "@proliferate/ui/icons";
import { usePlanPicker } from "@/hooks/plans/ui/use-plan-picker";
import {
  formatPlanAgentKindLabel,
  formatPlanDecisionStateLabel,
} from "@/lib/domain/plans/plan-presentation";
import { PLAN_PICKER_SEARCH_PLACEHOLDER } from "@/copy/plans/plan-picker-copy";

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
            <Spinner className="size-4" />
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
