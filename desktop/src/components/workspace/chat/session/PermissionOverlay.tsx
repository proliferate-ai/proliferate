import type { PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";
import { Button } from "@/components/ui/Button";
import {
  resolvePermissionActionLabel,
  resolvePermissionPromptPresentation,
} from "@/lib/domain/chat/permission-prompt";

export function InlinePermissionPrompt({
  title,
  toolCallId,
  modeLabel,
  actions,
  onSelectOption,
  onAllow,
  onDeny,
  embeddedInComposer = false,
}: {
  title: string;
  toolCallId?: string | null;
  modeLabel?: string | null;
  actions: PermissionOptionAction[];
  onSelectOption: (optionId: string) => void;
  onAllow: () => void;
  onDeny: () => void;
  embeddedInComposer?: boolean;
}) {
  const presentation = resolvePermissionPromptPresentation({
    title,
    toolCallId,
    currentModeLabel: modeLabel,
  });
  const hasExplicitActions = actions.length > 0;
  const actionsRow = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {hasExplicitActions ? actions.map((action) => {
        const isAllow = action.kind?.startsWith("allow") ?? false;
        return (
          <Button
            key={action.optionId}
            type="button"
            onClick={() => onSelectOption(action.optionId)}
            variant={isAllow ? "primary" : "secondary"}
            size="md"
            className="rounded-xl px-5"
          >
            {resolvePermissionActionLabel(action, presentation)}
          </Button>
        );
      }) : (
        <>
          <Button
            type="button"
            onClick={onDeny}
            variant="secondary"
            size="md"
            className="rounded-xl px-5"
          >
            Deny
          </Button>
          <Button
            type="button"
            onClick={onAllow}
            variant="primary"
            size="md"
            className="rounded-xl px-5"
          >
            Allow
          </Button>
        </>
      )}
    </div>
  );

  if (embeddedInComposer) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-col gap-4 px-5 pt-4">
          <div className="min-w-0 flex-1">
            {presentation.kind === "mode_switch" && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 font-medium uppercase tracking-[0.16em]">
                  Mode switch
                </span>
                {presentation.currentModeLabel && (
                  <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2.5 py-1">
                    Current: {presentation.currentModeLabel}
                  </span>
                )}
                {presentation.targetModeLabel && (
                  <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2.5 py-1">
                    Target: {presentation.targetModeLabel}
                  </span>
                )}
              </div>
            )}
            <div className="text-[15px] font-medium leading-7 text-foreground">
              {presentation.title}
            </div>
            {presentation.description && (
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                {presentation.description}
              </div>
            )}
            {presentation.showToolCallId && toolCallId && (
              <div className="mt-3 font-mono text-xs tracking-[0.14em] text-muted-foreground/90">
                {toolCallId}
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border/70 px-4 pb-3 pt-2">
          <div className="px-1 text-xs text-muted-foreground">
            {presentation.kind === "mode_switch"
              ? "This panel reflects live session state, even if the assistant has not acknowledged the switch yet."
              : "Waiting for approval."}
          </div>
          {actionsRow}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-2xl border border-border bg-background px-6 py-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {presentation.kind === "mode_switch" && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 font-medium uppercase tracking-[0.16em]">
                Mode switch
              </span>
              {presentation.currentModeLabel && (
                <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2.5 py-1">
                  Current: {presentation.currentModeLabel}
                </span>
              )}
              {presentation.targetModeLabel && (
                <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2.5 py-1">
                  Target: {presentation.targetModeLabel}
                </span>
              )}
            </div>
          )}
          <div className="text-[15px] font-medium leading-7 text-foreground">
            {presentation.title}
          </div>
          {presentation.description && (
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              {presentation.description}
            </div>
          )}
          {presentation.showToolCallId && toolCallId && (
            <div className="mt-3 font-mono text-xs tracking-[0.14em] text-muted-foreground/90">
              {toolCallId}
            </div>
          )}
        </div>

        {actionsRow}
      </div>
    </div>
  );
}
