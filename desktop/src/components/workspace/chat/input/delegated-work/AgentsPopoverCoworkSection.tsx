import { Button } from "@/components/ui/Button";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/use-delegated-work-composer";
import { PopoverSection } from "./PopoverSection";

export function AgentsPopoverCoworkSection({
  cowork,
  onClose,
}: {
  cowork: NonNullable<DelegatedWorkComposerViewModel["cowork"]>;
  onClose: () => void;
}) {
  return (
    <PopoverSection title="Cowork">
      <div className="space-y-0.5">
        {cowork.rows.map((workspace) => (
          <div key={workspace.ownershipId} className="rounded-md px-1 py-0.5 hover:bg-muted/40">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex h-7 w-full min-w-0 justify-between gap-2 rounded-md px-1.5 py-0 text-left hover:bg-transparent"
              onClick={() => {
                cowork.openWorkspace(workspace.workspaceId);
                onClose();
              }}
            >
              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                {workspace.label}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {workspace.sessionCount} sessions
              </span>
            </Button>
            {workspace.sessions.map((session) => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                key={session.codingSessionId}
                className="mt-0.5 flex h-6 w-full min-w-0 justify-between gap-2 rounded-md px-1.5 py-0 text-left hover:bg-muted/60"
                onClick={() => {
                  cowork.openSession({
                    workspaceId: workspace.workspaceId,
                    sessionId: session.codingSessionId,
                  });
                  onClose();
                }}
              >
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {session.label}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {session.statusLabel}
                </span>
              </Button>
            ))}
          </div>
        ))}
      </div>
    </PopoverSection>
  );
}
