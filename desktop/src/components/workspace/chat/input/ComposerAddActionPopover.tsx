import { useState, type MouseEvent, type ReactNode } from "react";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Button } from "@/components/ui/Button";
import {
  ArrowLeft,
  ClipboardList,
  FilePlus,
  GitPullRequest,
  Plus,
} from "@/components/ui/icons";
import { ComposerControlButton } from "./ComposerControlButton";
import { ComposerPopoverSurface } from "./ComposerPopoverSurface";
import { PlanPickerContentBody } from "./PlanPickerPopover";

interface ReviewAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface ComposerAddActionPopoverProps {
  canAttachFile: boolean;
  attachFileDetail: string;
  canAttachPlan: boolean;
  attachPlanDetail: string;
  canStartReview: boolean;
  reviewDetail: string;
  workspaceUiKey: string | null;
  sdkWorkspaceId: string | null;
  onAttachFile: () => void;
  onStartReview: (anchor: ReviewAnchor) => void;
}

type AddActionView = "menu" | "plans";

export function ComposerAddActionPopover({
  canAttachFile,
  attachFileDetail,
  canAttachPlan,
  attachPlanDetail,
  canStartReview,
  reviewDetail,
  workspaceUiKey,
  sdkWorkspaceId,
  onAttachFile,
  onStartReview,
}: ComposerAddActionPopoverProps) {
  const [view, setView] = useState<AddActionView>("menu");

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          iconOnly
          icon={<Plus className="size-4" />}
          label="Add"
          title="Add file, plan, or review agents"
          aria-label="Add file, plan, or review agents"
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
              <ComposerActionRow
                icon={<GitPullRequest className="size-4 text-muted-foreground" />}
                label="Spin up code review agents"
                detail={reviewDetail}
                disabled={!canStartReview}
                onClick={(event) => {
                  onStartReview(rectToReviewAnchor(event.currentTarget.getBoundingClientRect()));
                  close();
                }}
              />
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
    <PopoverMenuItem
      icon={icon}
      label={label}
      disabled={disabled}
      onClick={onClick}
      className="items-start [&>span:first-child]:mt-0.5"
    >
      <span className="mt-0.5 block whitespace-normal text-xs leading-4 text-muted-foreground">
        {detail}
      </span>
    </PopoverMenuItem>
  );
}

function rectToReviewAnchor(rect: DOMRect): ReviewAnchor {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}
