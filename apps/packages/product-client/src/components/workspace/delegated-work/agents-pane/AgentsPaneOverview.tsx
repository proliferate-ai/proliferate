import { Button } from "#product/primitives/Button";
import { Spinner } from "#product/primitives/Spinner";
import { AgentIdentityGlyph } from "#product/components/workspace/delegated-work/AgentIdentityGlyph";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type {
  AgentsPaneChild,
  AgentsPaneModel,
  AgentsPaneParent,
} from "#product/lib/domain/delegated-work/agents-pane-model";

function parentChildren(parent: AgentsPaneParent): readonly AgentsPaneChild[] {
  return parent.groups.flatMap((group) => group.children);
}

function ParentSealStack({
  workspaceId,
  parent,
}: {
  workspaceId: string;
  parent: AgentsPaneParent;
}) {
  const children = parentChildren(parent);
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="flex items-center -space-x-1">
        {children.map((child) => (
          <AgentIdentityGlyph
            key={child.sessionId}
            identity={buildDelegatedAgentIdentity({
              id: child.sessionLinkId,
              title: child.title,
              workspaceId,
              sessionId: child.sessionId,
              sessionLinkId: child.sessionLinkId,
            })}
            dimension={18}
            closed={child.group === "closed"}
            label={`Identity mark for ${child.title}`}
          />
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
        <div className="flex min-w-0 flex-col items-start gap-2 px-2 py-3">
          <p className="text-ui text-muted-foreground">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      );
    }
    if (loading) {
      return (
        <div className="flex min-h-11 items-center gap-2 px-2 text-ui text-muted-foreground">
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
        <Button
          key={parent.sessionId}
          type="button"
          variant="unstyled"
          size="unstyled"
          title={parent.title}
          onClick={() => onSelectParent(parent)}
          className={`flex min-h-11 min-w-0 items-center justify-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover active:bg-active ${
            parent.closedOnly ? "opacity-60" : ""
          }`}
        >
          <span
            className={`min-w-0 flex-1 truncate text-ui font-medium ${
              parent.closedOnly ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {parent.title}
          </span>
          <ParentSealStack workspaceId={workspaceId} parent={parent} />
        </Button>
      ))}
    </div>
  );
}
