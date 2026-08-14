import type { KeyboardEvent, MouseEvent } from "react";
import { Button } from "#product/primitives/Button";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
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
 * One roster row for a subagent child, composed on the `RosterRow` pattern.
 * The whole row is the detail action; the quiet per-child actions live in the
 * row's `actions` slot and stop their own click/keyboard events so each stays
 * independently reachable without also activating the row.
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

  const stopRowActivation = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    }
  };

  return (
    <RosterRow
      leading={
        <AgentIdentityGlyph
          identity={identity}
          dimension={18}
          closed={closed}
          label={`Identity mark for ${child.title}`}
        />
      }
      title={
        <span title={child.title} className={closed ? "text-muted-foreground" : undefined}>
          {child.title}
        </span>
      }
      secondary={child.detailLabel}
      actions={child.actions.map((action) => (
        <Button
          key={action}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${ACTION_LABELS[action]} ${child.title}`}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onAction(child, action);
          }}
          onKeyDown={stopRowActivation}
          className="h-7 shrink-0 px-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          {ACTION_LABELS[action]}
        </Button>
      ))}
      onSelect={() => onOpenDetail(child)}
    />
  );
}
