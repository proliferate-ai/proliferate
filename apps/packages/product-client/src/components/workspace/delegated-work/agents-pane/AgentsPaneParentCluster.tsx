import type {
  AgentsPaneAction,
  AgentsPaneChild,
  AgentsPaneParent,
} from "#product/lib/domain/delegated-work/agents-pane-model";
import { AgentsPaneRosterRow } from "./AgentsPaneRosterRow";

/**
 * One parent's cluster: exactly the nonempty Running/Available/Closed
 * sections in model order. The model already grouped by the server's
 * presentation verdict, so no re-derivation happens here.
 */
export function AgentsPaneParentCluster({
  workspaceId,
  parent,
  onOpenDetail,
  onAction,
}: {
  workspaceId: string;
  parent: AgentsPaneParent;
  onOpenDetail: (child: AgentsPaneChild) => void;
  onAction: (child: AgentsPaneChild, action: AgentsPaneAction) => void;
}) {
  const groups = parent.groups.filter((group) => group.children.length > 0);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} className="min-w-0">
          <h3 className="px-2 pb-1 text-ui-sm font-medium text-muted-foreground">
            {group.label}
          </h3>
          <div className="flex min-w-0 flex-col">
            {group.children.map((child) => (
              <AgentsPaneRosterRow
                key={child.sessionId}
                workspaceId={workspaceId}
                child={child}
                onOpenDetail={onOpenDetail}
                onAction={onAction}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
