import { Button } from "#product/primitives/Button";
import { ExternalLink } from "#product/primitives/icons/core";
import { AgentIdentityGlyph } from "#product/components/patterns/AgentIdentityGlyph";
import type {
  DelegatedWorkComposerViewModel,
} from "#product/hooks/chat/facade/use-delegated-work-composer";
import { PopoverSection } from "#product/components/workspace/chat/input/delegated-work/PopoverSection";

type SubagentRows = NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
type SubagentRow = SubagentRows["rows"][number];

export function AgentsPopoverSubagentSection({
  subagents,
  detail,
  onClose,
}: {
  subagents: NonNullable<DelegatedWorkComposerViewModel["subagents"]>;
  detail?: string | null;
  onClose: () => void;
}) {
  return (
    <PopoverSection
      title="Subagents"
      detail={detail}
      headerAriaLabel="Open subagents in Agents"
      onHeaderClick={() => {
        subagents.openCluster();
        onClose();
      }}
    >
      {subagents.parent && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-1 flex h-auto w-full justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/40"
          onClick={() => {
            subagents.openParent();
            onClose();
          }}
        >
          <span className="min-w-0">
            <span className="block truncate text-ui font-medium text-foreground">Parent agent</span>
            <span className="block truncate text-ui-sm text-muted-foreground">
              {subagents.parent.label}
            </span>
          </span>
          <ExternalLink className="icon-paired shrink-0 text-muted-foreground" />
        </Button>
      )}
      <div className="space-y-0.5">
        {subagents.rows.map((row) => (
          <SubagentPopoverRow
            key={row.sessionLinkId}
            row={row}
            onOpen={() => {
              subagents.openSubagent(row.childSessionId);
              onClose();
            }}
          />
        ))}
      </div>
    </PopoverSection>
  );
}

function SubagentPopoverRow({
  row,
  onOpen,
}: {
  row: SubagentRow;
  onOpen: () => void;
}) {
  const secondaryLabel = row.latestCompletionLabel ?? row.statusLabel;

  return (
    <div className="rounded-md px-1 py-0.5 hover:bg-muted/40">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full min-w-0 justify-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-transparent"
        onClick={onOpen}
      >
        <AgentIdentityGlyph
          identity={row.identity}
          closed={row.statusCategory === "closed"}
          className={`icon-compact shrink-0 text-chat ${row.identity.textColorClassName}`}
        />
        <span className="min-w-0">
          <span className="block truncate text-ui font-medium text-foreground">
            {row.identity.displayName}
          </span>
          <span className="block truncate text-ui-sm font-normal text-muted-foreground">
            {secondaryLabel}
          </span>
        </span>
      </Button>
    </div>
  );
}
