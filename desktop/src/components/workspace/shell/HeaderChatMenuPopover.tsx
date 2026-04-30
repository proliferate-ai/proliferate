import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import {
  BrailleSweepBadge,
  ChevronRight,
  ListFilter,
  ProliferateIcon,
  ProviderIcon,
} from "@/components/ui/icons";
import type { ChatTabEntry } from "@/hooks/sessions/use-workspace-chat-tabs";
import {
  type HeaderSubagentChildRow,
  type HeaderSubagentTabsViewModel,
} from "@/hooks/chat/subagents/use-header-subagent-tabs";

interface HeaderChatMenuPopoverProps {
  chatTabs: ChatTabEntry[];
  subagentTabs: HeaderSubagentTabsViewModel | null;
  renderSessionIcon: (tab: ChatTabEntry) => ReactNode;
  renderSessionStatusBadge: (tab: ChatTabEntry) => ReactNode;
  onOpenChatTab: (tab: ChatTabEntry) => void;
  onOpenSession: (sessionId: string) => void;
}

export function HeaderChatMenuPopover({
  chatTabs,
  subagentTabs,
  renderSessionIcon,
  renderSessionStatusBadge,
  onOpenChatTab,
  onOpenSession,
}: HeaderChatMenuPopoverProps) {
  const subagentChildSessionIds = new Set(
    subagentTabs?.children.map((child) => child.sessionId) ?? [],
  );
  const menuChatTabs = chatTabs.filter((tab) => !subagentChildSessionIds.has(tab.id));
  const shouldShowSyntheticParent = !!subagentTabs?.parent
    && !menuChatTabs.some((tab) => tab.id === subagentTabs.parent?.sessionId);

  if (chatTabs.length <= 1 && !subagentTabs) {
    return null;
  }

  return (
    <PopoverButton
      align="end"
      trigger={(
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Open chat tabs"
          className="mb-0.5 size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <ListFilter className="size-3.5" />
        </Button>
      )}
      className="w-72 rounded-lg border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <div className="relative max-h-80 overflow-visible">
          {menuChatTabs.length > 0 && (
            <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Open chats
            </div>
          )}
          {menuChatTabs.map((tab) => {
            const hasSubagentFlyout = subagentTabs?.rootSessionId === tab.id
              && subagentTabs.children.length > 0;
            return (
              <HeaderChatMenuRow
                key={tab.id}
                icon={renderSessionIcon(tab)}
                label={tab.title}
                active={tab.isActive}
                trailing={hasSubagentFlyout
                  ? <ChevronRight className="size-3.5 text-muted-foreground" />
                  : renderSessionMenuTrailing(tab, renderSessionStatusBadge)}
                onClick={() => {
                  onOpenChatTab(tab);
                  close();
                }}
                subagents={hasSubagentFlyout ? subagentTabs.children : []}
                onOpenSubagent={(sessionId) => {
                  onOpenSession(sessionId);
                  close();
                }}
              />
            );
          })}
          {shouldShowSyntheticParent && subagentTabs?.parent && (
            <HeaderChatMenuRow
              icon={(
                <ProviderIcon
                  kind={subagentTabs.parent.agentKind}
                  className="size-3.5 shrink-0"
                />
              )}
              label={subagentTabs.parent.title}
              active={false}
              trailing={<ChevronRight className="size-3.5 text-muted-foreground" />}
              onClick={() => {
                onOpenSession(subagentTabs.parent!.sessionId);
                close();
              }}
              subagents={subagentTabs.children}
              onOpenSubagent={(sessionId) => {
                onOpenSession(sessionId);
                close();
              }}
            >
              {subagentTabs.parent.meta && (
                <span className="block truncate text-xs text-muted-foreground">
                  {subagentTabs.parent.meta}
                </span>
              )}
            </HeaderChatMenuRow>
          )}
        </div>
      )}
    </PopoverButton>
  );
}

function HeaderChatMenuRow({
  icon,
  label,
  active,
  trailing,
  children,
  subagents,
  onClick,
  onOpenSubagent,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
  subagents: HeaderSubagentChildRow[];
  onClick: () => void;
  onOpenSubagent: (sessionId: string) => void;
}) {
  const hasSubagents = subagents.length > 0;
  const [expanded, setExpanded] = useState(false);
  if (!hasSubagents) {
    return (
      <div className="relative">
        <PopoverMenuItem
          icon={icon}
          label={label}
          trailing={trailing}
          className={active ? "bg-accent/70" : ""}
          onClick={onClick}
        >
          {children}
        </PopoverMenuItem>
      </div>
    );
  }

  return (
    <div className="group/header-chat-row relative">
      <div className={`flex w-full items-stretch rounded-lg transition-colors hover:bg-accent ${
        active ? "bg-accent/70" : ""
      }`}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-w-0 flex-1 justify-start gap-2.5 rounded-lg rounded-r-none px-2.5 py-2 text-sm text-foreground hover:bg-transparent"
          onClick={onClick}
        >
          {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate">{label}</span>
            {children}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-label={`Show subagents for ${label}`}
          title="Show subagents"
          className="h-auto w-8 shrink-0 rounded-lg rounded-l-none px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          <ChevronRight className={`size-3.5 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
          />
        </Button>
      </div>
      {expanded && (
        <div className="ml-6 mt-px flex flex-col gap-px border-l border-border/70 pl-2">
          <SubagentMenuItems subagents={subagents} onOpenSubagent={onOpenSubagent} />
        </div>
      )}
      <div className="invisible absolute left-full top-0 z-10 w-72 rounded-lg border border-border bg-popover p-1 opacity-0 shadow-floating transition-opacity group-hover/header-chat-row:visible group-hover/header-chat-row:opacity-100 group-focus-within/header-chat-row:visible group-focus-within/header-chat-row:opacity-100">
        <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Subagents
        </div>
        <SubagentMenuItems subagents={subagents} onOpenSubagent={onOpenSubagent} />
      </div>
    </div>
  );
}

function SubagentMenuItems({
  subagents,
  onOpenSubagent,
}: {
  subagents: HeaderSubagentChildRow[];
  onOpenSubagent: (sessionId: string) => void;
}) {
  return (
    <>
      {subagents.map((child) => (
        <PopoverMenuItem
          key={child.sessionLinkId}
          icon={(
            <span
              className="flex size-4 shrink-0 items-center justify-center"
              style={{ color: child.color }}
              aria-hidden="true"
            >
              <ProliferateIcon className="size-4" />
            </span>
          )}
          label={child.title}
          trailing={renderSubagentMenuTrailing(child)}
          className={child.isActive ? "bg-accent/70" : ""}
          onClick={() => onOpenSubagent(child.sessionId)}
        >
          {child.meta && (
            <span className="block truncate text-xs text-muted-foreground">
              {child.meta}
            </span>
          )}
        </PopoverMenuItem>
      ))}
    </>
  );
}

function renderSessionMenuTrailing(
  tab: ChatTabEntry,
  renderSessionStatusBadge: (tab: ChatTabEntry) => ReactNode,
): ReactNode {
  const status = renderSessionStatusBadge(tab);
  if (status) {
    return status;
  }
  if (tab.isActive) {
    return <span className="size-1.5 rounded-full bg-foreground/70" />;
  }
  return undefined;
}

function renderSubagentMenuTrailing(child: HeaderSubagentChildRow): ReactNode {
  if (child.wakeScheduled) {
    return <span className="text-xs text-foreground">Wake</span>;
  }
  if (child.statusLabel === "Failed") {
    return <span className="text-xs text-destructive">Failed</span>;
  }
  if (child.statusLabel === "Working") {
    return <BrailleSweepBadge className="text-[10px] text-muted-foreground" />;
  }
  if (child.isActive) {
    return <span className="size-1.5 rounded-full bg-foreground/70" />;
  }
  return <span className="text-xs text-muted-foreground">{child.statusLabel}</span>;
}
