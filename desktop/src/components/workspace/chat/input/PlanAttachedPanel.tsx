import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";
import { ClipboardList, Spinner } from "@/components/ui/icons";
import type { CanonicalPlanSourceKind, PlanEntry } from "@anyharness/sdk";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useChatPermissionActions } from "@/hooks/chat/use-chat-permission-actions";
import { resolvePermissionActionLabel, resolvePermissionPromptPresentation } from "@/lib/domain/chat/permission-prompt";

interface PlanAttachedPanelProps {
  sourceKind: CanonicalPlanSourceKind;
  entries: PlanEntry[];
  body: string | null;
  isActive: boolean;
}

export function PlanAttachedPanel({
  sourceKind,
  entries,
  body,
  isActive,
}: PlanAttachedPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const { pendingApproval, pendingApprovalActions, currentModeLabel } = useActiveChatSessionState();
  const {
    handleSelectPermissionOption,
    handleAllowPermission,
    handleDenyPermission,
  } = useChatPermissionActions();
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const hasStructuredEntries = entries.length > 0;
  const showApprovalActions = sourceKind === "mode_switch" && pendingApproval !== null;
  const permissionPresentation = showApprovalActions
    ? resolvePermissionPromptPresentation({
      title: pendingApproval.title,
      toolCallId: pendingApproval.toolCallId ?? null,
      currentModeLabel,
    })
    : null;

  const header = (
    <div className="flex min-w-0 items-center">
      <div className="text-chat flex min-w-0 items-center gap-1">
        <div className="flex items-center justify-center text-muted-foreground/60" style={{ opacity: 1 }}>
          <ClipboardList className="size-4 text-foreground" />
        </div>
        <span className="min-w-0 truncate text-muted-foreground">
          {hasStructuredEntries
            ? `${completedCount} out of ${entries.length} tasks completed`
            : isActive
              ? "Plan ready for approval"
              : "Presented plan"}
        </span>
      </div>
    </div>
  );

  return (
    <ComposerAttachedPanel
      header={header}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((v) => !v)}
    >
      <div className="flex flex-col gap-2 bg-card/70 p-2 backdrop-blur-sm">
        {showApprovalActions && permissionPresentation && (
          <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
            <div className="flex flex-wrap gap-2">
              {pendingApprovalActions.length > 0 ? pendingApprovalActions.map((action) => {
                const isAllow = action.kind?.startsWith("allow") ?? false;
                return (
                  <Button
                    key={action.optionId}
                    type="button"
                    onClick={() => handleSelectPermissionOption(action.optionId)}
                    variant={isAllow ? "primary" : "secondary"}
                    size="md"
                    className="rounded-xl px-4"
                  >
                    {resolvePermissionActionLabel(action, permissionPresentation)}
                  </Button>
                );
              }) : (
                <>
                  <Button
                    type="button"
                    onClick={handleDenyPermission}
                    variant="secondary"
                    size="md"
                    className="rounded-xl px-4"
                  >
                    Deny
                  </Button>
                  <Button
                    type="button"
                    onClick={handleAllowPermission}
                    variant="primary"
                    size="md"
                    className="rounded-xl px-4"
                  >
                    Allow
                  </Button>
                </>
              )}
            </div>
            <p className="text-chat leading-5 text-muted-foreground">
              {permissionPresentation.description ?? "Waiting for approval."}
            </p>
          </div>
        )}

        <div className="max-h-[min(56vh,34rem)] overflow-y-auto">
          {hasStructuredEntries ? (
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <PlanEntryRow
                  key={index}
                  index={index + 1}
                  content={entry.content}
                  status={entry.status}
                />
              ))}
            </div>
          ) : body ? (
            <div data-chat-selection-unit>
              <MarkdownRenderer content={body} className="select-text px-1" />
            </div>
          ) : null}
        </div>
      </div>
    </ComposerAttachedPanel>
  );
}

function PlanEntryRow({
  index,
  content,
  status,
}: {
  index: number;
  content: string;
  status: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex shrink-0 items-start gap-0.5">
        <div className="flex h-3.5 w-[1.125rem] items-center justify-center overflow-hidden">
          <PlanStatusIcon status={status} />
        </div>
        <span className="text-chat leading-4">{index}.</span>
      </div>
      <span className="text-chat flex-1 leading-4">{content}</span>
    </div>
  );
}

function PlanStatusIcon({ status }: { status: string }) {
  if (status === "in_progress") {
    return <Spinner className="size-3.5" />;
  }

  if (status === "completed") {
    return (
      <svg width="20" height="21" viewBox="0 0 20 21" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[9px] w-[9px] shrink-0 text-foreground">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10 2.9032C14.3713 2.9032 17.915 6.4469 17.915 10.8182C17.915 15.1896 14.3713 18.7333 10 18.7333C5.62867 18.7333 2.08496 15.1896 2.08496 10.8182C2.08496 6.4469 5.62867 2.9032 10 2.9032ZM8.89 13.4547L14.1191 8.22559C14.3788 7.96589 14.3788 7.54389 14.1191 7.28419C13.8594 7.02449 13.4374 7.02449 13.1777 7.28419L8.41943 12.0425L6.82227 10.4453C6.56257 10.1856 6.14057 10.1856 5.88087 10.4453C5.62117 10.705 5.62117 11.127 5.88087 11.3867L7.94873 13.4547C8.20843 13.7144 8.6303 13.7144 8.89 13.4547Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  // Pending — empty circle
  return (
    <svg width="20" height="21" viewBox="0 0 20 21" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[9px] w-[9px] shrink-0 text-muted-foreground">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 2.9032C14.3713 2.9032 17.915 6.4469 17.915 10.8182C17.915 15.1896 14.3713 18.7333 10 18.7333C5.62867 18.7333 2.08496 15.1896 2.08496 10.8182C2.08496 6.4469 5.62867 2.9032 10 2.9032ZM10 4.23328C6.3632 4.23328 3.41504 7.18144 3.41504 10.8182C3.41504 14.455 6.3632 17.4032 10 17.4032C13.6368 17.4032 16.585 14.455 16.585 10.8182C16.585 7.18144 13.6368 4.23328 10 4.23328Z"
        fill="currentColor"
      />
    </svg>
  );
}
