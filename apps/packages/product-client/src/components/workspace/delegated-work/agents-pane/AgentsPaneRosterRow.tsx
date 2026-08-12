import { Button } from "#product/primitives/Button";
import { AgentIdentityGlyph } from "#product/components/workspace/delegated-work/AgentIdentityGlyph";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type {
  AgentsPaneAction,
  AgentsPaneChild,
} from "#product/lib/domain/delegated-work/agents-pane-model";

const ACTION_LABELS: Record<AgentsPaneAction, string> = {
  close: "Close",
  open: "Open",
  promote: "Promote",
};

/**
 * One roster row for a subagent child. The whole row is the detail action;
 * the quiet per-child actions are sibling buttons (never nested) so each stays
 * independently keyboard-reachable.
 */
export function AgentsPaneRosterRow({
  workspaceId,
  child,
  onOpenDetail,
  onAction,
}: {
  workspaceId: string;
  child: AgentsPaneChild;
  onOpenDetail: (child: AgentsPaneChild) => void;
  onAction: (child: AgentsPaneChild, action: AgentsPaneAction) => void;
}) {
  const identity = buildDelegatedAgentIdentity({
    id: child.sessionLinkId,
    title: child.title,
    workspaceId,
    sessionId: child.sessionId,
    sessionLinkId: child.sessionLinkId,
  });
  const closed = child.group === "closed";

  return (
    <div className="group/agents-pane-row flex min-h-11 min-w-0 items-center rounded-lg hover:bg-hover">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        title={child.title}
        onClick={() => onOpenDetail(child)}
        className="flex min-w-0 flex-1 items-center justify-start gap-2 px-2 py-1.5 text-left"
      >
        <AgentIdentityGlyph
          identity={identity}
          dimension={18}
          closed={closed}
          label={`Identity mark for ${child.title}`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-ui font-medium ${
              closed ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {child.title}
          </span>
          <span className="block truncate text-ui-sm font-normal text-muted-foreground">
            {child.detailLabel}
          </span>
        </span>
      </Button>
      {child.actions.map((action) => (
        <Button
          key={action}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${ACTION_LABELS[action]} ${child.title}`}
          onClick={() => onAction(child, action)}
          className="mr-1 h-7 shrink-0 px-2 text-muted-foreground opacity-0 hover:bg-hover active:bg-active group-hover/agents-pane-row:opacity-100 focus-visible:opacity-100"
        >
          {ACTION_LABELS[action]}
        </Button>
      ))}
    </div>
  );
}
