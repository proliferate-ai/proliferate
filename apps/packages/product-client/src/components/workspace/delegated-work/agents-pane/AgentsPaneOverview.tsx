import { Button } from "#product/primitives/Button";
import { Spinner } from "#product/primitives/Spinner";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type {
  AgentsPaneModel,
  AgentsPaneParent,
} from "#product/lib/domain/delegated-work/agents-pane-model";

function ParentSealStack({
  workspaceId,
  parent,
}: {
  workspaceId: string;
  parent: AgentsPaneParent;
}) {
  const children = parent.children;
  const visibleChildren = children.slice(0, 5);
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="flex items-center -space-x-1">
        {visibleChildren.map((child) => (
          <span
            key={child.sessionId}
            className="flex size-5 items-center justify-center rounded-full bg-surface-elevated ring-1 ring-border"
          >
            <AgentIdentityGlyph
              identity={buildDelegatedAgentIdentity({
                id: child.sessionLinkId,
                title: child.title,
                workspaceId,
                sessionId: child.sessionId,
                sessionLinkId: child.sessionLinkId,
              })}
              dimension={12}
              closed={child.group === "closed"}
              label={`Identity mark for ${child.title}`}
            />
          </span>
        ))}
      </span>
      <span className="text-ui-sm text-muted-foreground">{children.length}</span>
    </span>
  );
}

/**
 * Overview of every parent roster. Parents stay in server order and
 * Closed-only parents remain visible (dimmed) so finished work is never
 * silently dropped. Clicking a parent navigates to its cluster.
 */
export function AgentsPaneOverview({
  workspaceId,
  model,
  loading,
  error,
  backgroundRefreshing = false,
  onRetry,
  onSelectParent,
}: {
  workspaceId: string;
  model: AgentsPaneModel | null;
  loading: boolean;
  error: string | null;
  backgroundRefreshing?: boolean;
  onRetry: () => void;
  onSelectParent: (parent: AgentsPaneParent) => void;
}) {
  // Initial load and initial error only apply before a model exists; once we
  // have data, refreshes stay in the background without unmounting the list.
  if (!model) {
    if (error) {
      return (
        <div role="alert" className="flex min-w-0 flex-col items-start gap-2 px-2 py-3">
          <p className="text-ui text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      );
    }
    if (loading) {
      return (
        <div
          role="status"
          className="flex min-h-11 items-center gap-2 px-2 text-ui text-muted-foreground"
        >
          <Spinner className="icon-compact" />
          Loading agents…
        </div>
      );
    }
    return null;
  }

  if (model.parents.length === 0) {
    return (
      <p className="px-2 py-3 text-ui text-muted-foreground">No agents yet</p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      {backgroundRefreshing ? (
        <div
          role="status"
          aria-label="Refreshing agents"
          className="flex items-center gap-2 px-2 pb-1 text-ui-sm text-muted-foreground"
        >
          <Spinner className="icon-compact" />
          Refreshing
        </div>
      ) : null}
      {model.parents.map((parent) => (
        <RosterRow
          key={parent.sessionId}
          title={
            <span
              title={parent.title}
              className={parent.closedOnly ? "text-muted-foreground" : undefined}
            >
              {parent.title}
            </span>
          }
          trailing={<ParentSealStack workspaceId={workspaceId} parent={parent} />}
          onSelect={() => onSelectParent(parent)}
          className={parent.closedOnly ? "opacity-60" : undefined}
        />
      ))}
    </div>
  );
}
