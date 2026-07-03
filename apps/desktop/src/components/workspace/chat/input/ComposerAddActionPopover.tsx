import { useState, type MouseEvent, type ReactNode } from "react";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  ArrowLeft,
  ClipboardList,
  FilePlus,
  Plus,
} from "@proliferate/ui/icons";
import { Target } from "lucide-react";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { deriveGoalBarState } from "@proliferate/product-domain/activity/goal";
import { useSessionGoal } from "@/hooks/activity/derived/use-session-goal";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { useGoalBarStore } from "@/stores/activity/goal-bar-store";
import { PlanPickerContentBody } from "./PlanPickerContentBody";

interface ComposerAddActionPopoverProps {
  canAttachFile: boolean;
  attachFileDetail: string;
  canAttachPlan: boolean;
  attachPlanDetail: string;
  workspaceUiKey: string | null;
  sdkWorkspaceId: string | null;
  onAttachFile: () => void;
}

type AddActionView = "menu" | "plans";

export function ComposerAddActionPopover({
  canAttachFile,
  attachFileDetail,
  canAttachPlan,
  attachPlanDetail,
  workspaceUiKey,
  sdkWorkspaceId,
  onAttachFile,
}: ComposerAddActionPopoverProps) {
  const [view, setView] = useState<AddActionView>("menu");
  const activeSessionId = useActiveSessionId();
  const sessionGoal = useSessionGoal();
  const beginComposingGoal = useGoalBarStore((state) => state.beginComposing);
  // The empty-state goal affordance: offered only when the session supports
  // goals and none is live (the bar itself owns edit once a goal exists).
  const canSetGoal = !!sessionGoal
    && sessionGoal.capabilities.supported
    && deriveGoalBarState(sessionGoal.goal).kind !== "live";

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          iconOnly
          icon={<Plus className="size-4" />}
          label="Add"
          title="Add file or plan"
          aria-label="Add file or plan"
        />
      )}
      align="end"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
      onOpenChange={(open) => {
        if (!open) {
          setView("menu");
        }
      }}
    >
      {(close) => (
        <ComposerPopoverSurface
          className={view === "plans" ? "w-[min(24rem,calc(100vw-2rem))] p-0" : "w-72 p-1.5"}
          data-telemetry-mask={view === "plans" ? true : undefined}
        >
          {view === "plans" ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setView("menu")}
                  className="h-7 rounded-lg px-2 text-xs"
                >
                  <ArrowLeft className="size-3.5" />
                  Back
                </Button>
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  Attach plan
                </span>
              </div>
              <PlanPickerContentBody
                workspaceUiKey={workspaceUiKey}
                sdkWorkspaceId={sdkWorkspaceId}
                onClose={() => {
                  setView("menu");
                  close();
                }}
              />
            </>
          ) : (
            <div className="space-y-1">
              <ComposerActionRow
                icon={<FilePlus className="size-4 text-muted-foreground" />}
                label="Add file"
                detail={attachFileDetail}
                disabled={!canAttachFile}
                onClick={() => {
                  onAttachFile();
                  close();
                }}
              />
              <ComposerActionRow
                icon={<ClipboardList className="size-4 text-muted-foreground" />}
                label="Add plan"
                detail={attachPlanDetail}
                disabled={!canAttachPlan}
                onClick={() => setView("plans")}
              />
              {canSetGoal && (
                <ComposerActionRow
                  icon={<Target className="size-4 text-muted-foreground" />}
                  label="Set a goal"
                  detail="Give the agent an objective to keep pursuing."
                  disabled={false}
                  onClick={() => {
                    if (activeSessionId) {
                      beginComposingGoal(activeSessionId);
                    }
                    close();
                  }}
                />
              )}
            </div>
          )}
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

function ComposerActionRow({
  icon,
  label,
  detail,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="flex items-start gap-1">
      <PopoverMenuItem
        icon={icon}
        label={label}
        disabled={disabled}
        onClick={onClick}
        className="min-w-0 flex-1"
      >
        <span className="block whitespace-normal text-ui-sm text-muted-foreground">
          {detail}
        </span>
      </PopoverMenuItem>
    </div>
  );
}
