import { ArrowLeft } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { Spinner } from "#product/primitives/Spinner";
import { AgentsPaneDetail } from "#product/components/workspace/delegated-work/agents-pane/AgentsPaneDetail";
import { AgentsPaneOverview } from "#product/components/workspace/delegated-work/agents-pane/AgentsPaneOverview";
import { AgentsPaneParentCluster } from "#product/components/workspace/delegated-work/agents-pane/AgentsPaneParentCluster";
import { useAgentsPane } from "#product/hooks/agents/facade/use-agents-pane";

function PaneHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to agents"
          onClick={onBack}
        >
          <ArrowLeft className="icon-compact" />
        </Button>
      ) : null}
      <h2 className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
        {title}
      </h2>
    </header>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" className="flex h-full items-center justify-center gap-2 px-4 text-ui text-muted-foreground">
      <Spinner className="icon-compact" />
      {label}
    </div>
  );
}

export function AgentsPane({ workspaceId }: { workspaceId: string }) {
  const pane = useAgentsPane({ workspaceId });

  if (pane.route.kind === "overview") {
    return (
      <section aria-label="Agents" className="flex h-full min-h-0 min-w-0 flex-col">
        <PaneHeader title="Agents" />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
          <AgentsPaneOverview
            workspaceId={workspaceId}
            model={pane.overviewModel}
            loading={pane.initialLoading}
            error={pane.initialError}
            backgroundRefreshing={pane.backgroundRefreshing}
            onRetry={pane.retryRoster}
            onSelectParent={pane.selectParent}
          />
        </div>
      </section>
    );
  }

  if (pane.route.kind === "cluster") {
    return (
      <section
        aria-label="Agent group"
        aria-busy={pane.focusedLoading}
        className="flex h-full min-h-0 min-w-0 flex-col"
      >
        <PaneHeader
          title={pane.focusedParent?.title ?? "Agents"}
          onBack={pane.openOverview}
        />
        {pane.lifecycleError ? (
          <div role="alert" className="shrink-0 border-b border-border px-3 py-2 text-ui-sm text-muted-foreground">
            {pane.lifecycleError}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
          {pane.focusedParent ? (
            <AgentsPaneParentCluster
              workspaceId={workspaceId}
              parent={pane.focusedParent}
              onOpenDetail={pane.selectChild}
              onAction={pane.requestChildAction}
            />
          ) : pane.focusedError ? (
            <div role="alert" className="flex flex-col items-start gap-2 px-2 py-3">
              <span className="text-ui text-muted-foreground">{pane.focusedError}</span>
              <Button type="button" variant="outline" size="sm" onClick={pane.retryRoster}>
                Retry
              </Button>
            </div>
          ) : (
            <LoadingState label="Loading agents…" />
          )}
        </div>
      </section>
    );
  }

  if (!pane.selectedChild || !pane.selectedClientSessionId) {
    return (
      <section aria-label="Agent detail" className="flex h-full min-h-0 flex-col">
        <PaneHeader title="Agent" onBack={pane.back} />
        {pane.focusedError ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="text-ui text-muted-foreground">{pane.focusedError}</span>
            <Button type="button" variant="outline" size="sm" onClick={pane.retryRoster}>
              Retry
            </Button>
          </div>
        ) : (
          <LoadingState label="Loading agent…" />
        )}
      </section>
    );
  }

  const requestedAction = pane.actionRequest
    && pane.actionRequest.parentSessionId === pane.route.parentDurableId
    && pane.actionRequest.childSessionId === pane.route.childDurableId
      ? pane.actionRequest
      : null;

  return (
    <div className="relative h-full min-h-0 min-w-0">
      {pane.lifecycleError ? (
        <div role="alert" className="absolute inset-x-0 top-0 z-raised border-b border-border bg-sidebar-background px-3 py-2 text-ui-sm text-muted-foreground">
          {pane.lifecycleError}
        </div>
      ) : null}
      <AgentsPaneDetail
        key={`${pane.route.parentDurableId}:${pane.route.childDurableId}`}
        workspaceId={workspaceId}
        parentSessionId={pane.route.parentDurableId}
        childSessionId={pane.route.childDurableId}
        clientSessionId={pane.selectedClientSessionId}
        child={pane.selectedChild}
        isPaneRouteActive
        onBack={pane.back}
        onPromoted={pane.handlePromoted}
        onLifecycleError={(failure) => void pane.handleLifecycleError(failure)}
        requestedAction={requestedAction}
        onRequestedActionHandled={pane.clearActionRequest}
      />
    </div>
  );
}
