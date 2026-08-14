import type {
  AgentsPaneAction,
  AgentsPaneChild,
  AgentsPaneParent,
} from "#product/lib/domain/delegated-work/agents-pane-model";
import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { AgentsPaneRosterRow } from "./AgentsPaneRosterRow";

/**
 * One parent's cluster: exactly the nonempty Running/Available/Closed
 * sections in model order, each a `RosterPanel` whose label renders as a
 * semantic heading. The model already grouped by the server's presentation
 * verdict, so no re-derivation happens here.
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
          <RosterPanel title={group.label} titleAs="h3">
            {group.children.map((child) => (
              <li key={child.sessionId}>
                <AgentsPaneRosterRow
                  workspaceId={workspaceId}
                  child={child}
                  onOpenDetail={onOpenDetail}
                  onAction={onAction}
                />
              </li>
            ))}
          </RosterPanel>
        </section>
      ))}
    </div>
  );
}
