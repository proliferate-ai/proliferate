import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import type { WorkspaceMobilityConfirmSnapshot } from "@/stores/workspaces/workspace-mobility-ui-store";

function SummaryList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-3">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        {title}
      </p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}

export function WorkspaceMobilityConfirmDialog({
  snapshot,
  open,
  isPending,
  onClose,
  onConfirm,
}: {
  snapshot: WorkspaceMobilityConfirmSnapshot | null;
  open: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!snapshot) {
    return null;
  }

  const supportedSessions = (snapshot.sourcePreflight.sessions ?? [])
    .filter((session) => session.supported)
    .map((session) => session.agentKind);
  const skippedSessions = (snapshot.sourcePreflight.sessions ?? [])
    .filter((session) => !session.supported)
    .map((session) => (
      session.reason
        ? `${session.agentKind}: ${session.reason}`
        : session.agentKind
    ));
  const warnings = [...(snapshot.sourcePreflight.warnings ?? [])];
  const blockers = [
    ...(snapshot.sourcePreflight.blockers ?? []).map((blocker) => blocker.message),
    ...snapshot.cloudPreflight.blockers,
  ];
  const canConfirm = snapshot.sourcePreflight.canMove && snapshot.cloudPreflight.canStart;
  const hasActiveTerminalWarning = warnings.some((warning) => warning.includes("will not migrate"));
  const statusMessage = canConfirm
    ? (
        warnings.length > 0
          ? "Warnings below do not block the move. Anything marked as not migrating will stay in this environment."
          : "No blockers found. This workspace is ready to move."
      )
    : (
        hasActiveTerminalWarning
          ? "Active terminals stay local and do not block the move. The actual blocker is listed below."
          : "This workspace has blockers that must be resolved before it can move."
      );

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={isPending}
      title={snapshot.direction === "local_to_cloud" ? "Move this workspace to cloud?" : "Bring this workspace back local?"}
      description={snapshot.direction === "local_to_cloud"
        ? "The workspace will pause briefly while files and supported sessions move to the cloud runtime."
        : "The workspace will pause briefly while files and supported sessions move back to your local runtime."}
      sizeClassName="max-w-2xl"
      footer={(
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void onConfirm();
            }}
            disabled={!canConfirm}
            loading={isPending}
          >
            {snapshot.direction === "local_to_cloud" ? "Move to cloud" : "Bring back local"}
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-border/60 bg-card/70 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
            Status
          </p>
          <p className="mt-2 text-sm text-foreground">
            {statusMessage}
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
            Repository
          </p>
          <p className="mt-2 text-sm text-foreground">
            {snapshot.cloudPreflight.workspace.repo.owner}/{snapshot.cloudPreflight.workspace.repo.name}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Branch: {snapshot.sourcePreflight.branchName ?? snapshot.cloudPreflight.workspace.repo.branch}
          </p>
        </div>

        <SummaryList
          title="Supported sessions"
          items={supportedSessions}
          emptyLabel="No portable sessions will move."
        />

        <SummaryList
          title="Skipped sessions"
          items={skippedSessions}
          emptyLabel="No sessions need to be skipped."
        />

        <SummaryList
          title="Warnings"
          items={warnings}
          emptyLabel="No additional warnings. Nothing else will be left behind."
        />

        <SummaryList
          title="Blockers"
          items={blockers}
          emptyLabel="No blockers. This workspace is ready to move."
        />

        <div className="rounded-lg border border-border/60 bg-card/70 p-3 text-sm text-muted-foreground">
          MCP tool connections do not automatically follow the workspace. Reconnect any required MCP tools after the move finishes.
        </div>
      </div>
    </ModalShell>
  );
}
