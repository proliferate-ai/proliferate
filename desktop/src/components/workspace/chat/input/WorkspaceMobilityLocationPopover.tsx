import { Button } from "@/components/ui/Button";
import { BrailleSweepBadge, CircleAlert, LoaderCircle } from "@/components/ui/icons";
import { ComposerPopoverSurface } from "./ComposerPopoverSurface";
import type { MobilityPromptState } from "@/lib/domain/workspaces/mobility-prompt";

export function WorkspaceMobilityLocationPopover({
  prompt,
  isActionPending = false,
  onClose,
  onPrimaryAction,
}: {
  prompt: MobilityPromptState;
  isActionPending?: boolean;
  onClose: () => void;
  onPrimaryAction: () => void | Promise<void>;
}) {
  const leading = prompt.variant === "loading"
    ? <BrailleSweepBadge className="text-base text-foreground" />
    : prompt.variant === "actionable"
      ? null
      : prompt.variant === "in_flight"
        ? <LoaderCircle className="size-4 animate-spin text-foreground" />
        : <CircleAlert className="size-4 text-destructive" />;
  const hasPrimaryAction = Boolean(prompt.actionLabel && prompt.primaryActionKind);
  const secondaryLabel = hasPrimaryAction
    ? "Cancel"
    : prompt.variant === "actionable" || prompt.variant === "loading"
      ? "Cancel"
      : "Got it";

  return (
    <ComposerPopoverSurface className="w-[min(24rem,calc(100vw-2rem))] p-0">
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-start gap-2">
          {leading ? <div className="pt-0.5">{leading}</div> : null}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-foreground">
              {prompt.headline}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {prompt.body}
            </p>
            {prompt.helper && (
              <p className="mt-1 text-xs text-muted-foreground/80">
                {prompt.helper}
              </p>
            )}
          </div>
        </div>

        {prompt.warning && (
          <div className="rounded-xl bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
            {prompt.warning}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            {secondaryLabel}
          </Button>
          {prompt.actionLabel && prompt.primaryActionKind && (
            <Button
              size="sm"
              loading={isActionPending}
              onClick={() => {
                void onPrimaryAction();
              }}
            >
              {prompt.actionLabel}
            </Button>
          )}
        </div>
      </div>
    </ComposerPopoverSurface>
  );
}
