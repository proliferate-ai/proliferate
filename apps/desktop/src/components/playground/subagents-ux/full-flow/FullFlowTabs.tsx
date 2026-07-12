import { X } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { SubagentIdentityGlyph } from "../identity-receipts/SubagentIdentityGlyph";
import { AgentGlyph } from "../popover-pane/AgentGlyph";
import type {
  FullFlowArchivedSession,
  FullFlowChild,
  FullFlowParent,
} from "./FullFlowFixtures";

export type TabDescriptor =
  | { kind: "parent"; parentId: string }
  | { kind: "child"; parentId: string; childId: string }
  | { kind: "archived"; archivedId: string };

export function tabKey(tab: TabDescriptor): string {
  switch (tab.kind) {
    case "parent":
      return `parent:${tab.parentId}`;
    case "child":
      return `child:${tab.childId}`;
    case "archived":
      return `archived:${tab.archivedId}`;
  }
}

const TAB_SHELL_CLASS = "group/tab flex max-w-[240px] shrink-0 items-center rounded-md border";

function tabToneClass(selected: boolean): string {
  return selected
    ? "border-border bg-accent text-foreground"
    : "border-transparent text-muted-foreground hover:bg-accent/60";
}

function TabCloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-label={`Close tab for ${label} (keeps the session)`}
      title="Close tab — hides the tab only"
      onClick={onClose}
      className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100"
    >
      <X className="size-3" aria-hidden="true" />
    </Button>
  );
}

export function ParentTab({
  parent,
  selected,
  onSelect,
  onOpenCluster,
}: {
  parent: FullFlowParent;
  selected: boolean;
  onSelect: () => void;
  onOpenCluster: () => void;
}) {
  const bubbleChildren = parent.children.slice(0, 3);
  const overflow = parent.children.length - bubbleChildren.length;
  return (
    <div className={`${TAB_SHELL_CLASS} ${tabToneClass(selected)}`}>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        role="tab"
        id={`full-flow-tab-parent:${parent.id}`}
        aria-selected={selected}
        aria-controls="full-flow-chat"
        tabIndex={selected ? 0 : -1}
        title={parent.title}
        onClick={onSelect}
        className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
      >
        <span className="truncate text-ui font-medium">{parent.title}</span>
      </Button>
      {parent.children.length > 0 ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label={`${parent.children.length} delegated ${parent.children.length === 1 ? "agent" : "agents"} for ${parent.title} — open Agents pane`}
          title="Delegated agents — open Agents pane"
          onClick={onOpenCluster}
          className="mr-1 flex shrink-0 items-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        >
          <span className="flex items-center -space-x-1.5">
            {bubbleChildren.map((child) => (
              <span
                key={child.id}
                className="flex size-[16px] items-center justify-center rounded-full bg-background ring-1 ring-border"
              >
                <AgentGlyph id={child.id} size={10} />
              </span>
            ))}
          </span>
          {overflow > 0 ? (
            <span className="ml-0.5 font-mono text-xs text-muted-foreground">
              +{overflow}
            </span>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}

export function ChildTab({
  child,
  selected,
  onSelect,
  onCloseTab,
}: {
  child: FullFlowChild;
  selected: boolean;
  onSelect: () => void;
  onCloseTab: () => void;
}) {
  return (
    <div className={`${TAB_SHELL_CLASS} ${tabToneClass(selected)}`}>
      <TabCloseButton label={child.label} onClose={onCloseTab} />
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        role="tab"
        id={`full-flow-tab-child:${child.id}`}
        aria-selected={selected}
        aria-controls="full-flow-chat"
        tabIndex={selected ? 0 : -1}
        title={child.label}
        onClick={onSelect}
        className="flex min-w-0 items-center gap-1.5 py-1 pl-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
      >
        <SubagentIdentityGlyph
          seed={child.id}
          size={13}
          label={`Identity mark for ${child.label}`}
        />
        <span className="truncate text-ui font-medium">{child.label}</span>
      </Button>
    </div>
  );
}

export function ArchivedTab({
  session,
  selected,
  onSelect,
  onCloseTab,
}: {
  session: FullFlowArchivedSession;
  selected: boolean;
  onSelect: () => void;
  onCloseTab: () => void;
}) {
  return (
    <div className={`${TAB_SHELL_CLASS} ${tabToneClass(selected)}`}>
      <TabCloseButton label={session.label} onClose={onCloseTab} />
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        role="tab"
        id={`full-flow-tab-archived:${session.id}`}
        aria-selected={selected}
        aria-controls="full-flow-chat"
        tabIndex={selected ? 0 : -1}
        title={`${session.label} (archived)`}
        onClick={onSelect}
        className="flex min-w-0 items-center gap-1.5 py-1 pl-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
      >
        <SubagentIdentityGlyph
          seed={session.id}
          size={13}
          dimmed
          label={`Identity mark for ${session.label}`}
        />
        <span className="truncate text-ui font-medium text-muted-foreground">
          {session.label}
        </span>
      </Button>
    </div>
  );
}
