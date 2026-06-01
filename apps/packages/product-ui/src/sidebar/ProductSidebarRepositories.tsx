import type { HTMLAttributes, ReactNode } from "react";

import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";

import type {
  SidebarActionEvent,
  SidebarSectionMessageView,
  SidebarWorkspaceGroupView,
  SidebarWorkspaceRowView,
} from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";
import { ProductSidebarSectionHeader } from "./ProductSidebarLayout";

export function ProductSidebarRepositoriesSection({
  label,
  actions,
  panel,
  groups,
  message,
  onGroupToggle,
  onWorkspaceSelect,
  onAction,
  shortcutRevealVisible,
}: {
  label: string;
  actions?: ReactNode;
  panel?: ReactNode;
  groups: SidebarWorkspaceGroupView[];
  message?: SidebarSectionMessageView | null;
  onGroupToggle: (id: string) => void;
  onWorkspaceSelect: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
  shortcutRevealVisible: boolean;
}) {
  return (
    <section>
      <ProductSidebarSectionHeader label={label} actions={actions} />
      {panel ? (
        <div className="px-2 pb-1">
          {panel}
        </div>
      ) : null}
      <div className="flex flex-col gap-px">
        {groups.length > 0 ? groups.map((group) => (
          <WorkspaceGroup
            key={group.id}
            group={group}
            onGroupToggle={onGroupToggle}
            onWorkspaceSelect={onWorkspaceSelect}
            onAction={onAction}
            shortcutRevealVisible={shortcutRevealVisible}
          />
        )) : message ? (
          <ProductSidebarSectionMessage message={message} />
        ) : null}
      </div>
    </section>
  );
}

function ProductSidebarSectionMessage({
  message,
}: {
  message: SidebarSectionMessageView;
}) {
  return (
    <div className="mx-2 rounded-lg border border-sidebar-border/75 px-3 py-2 text-sidebar-muted-foreground">
      <div className="flex items-start gap-2">
        {message.status ? (
          <span className={`mt-0.5 shrink-0 ${message.tone === "danger" ? "text-destructive" : "text-sidebar-muted-foreground"
            }`}>
            {message.status}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className={`text-sm leading-4 ${message.tone === "danger" ? "text-destructive" : "text-sidebar-foreground"
            }`}>
            {message.title}
          </p>
          {message.description ? (
            <p className="mt-1 text-xs leading-4 text-sidebar-muted-foreground">
              {message.description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkspaceGroup({
  group,
  onGroupToggle,
  onWorkspaceSelect,
  onAction,
  shortcutRevealVisible,
}: {
  group: SidebarWorkspaceGroupView;
  onGroupToggle: (id: string) => void;
  onWorkspaceSelect: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
  shortcutRevealVisible: boolean;
}) {
  const groupAction = group.actions[0];
  const shouldShowHeader = !group.headerHidden;

  return (
    <div className="w-full min-w-0">
      {shouldShowHeader ? (
        <ProductSidebarRepoGroupHeader
          label={group.label}
          count={group.count}
          collapsed={group.collapsed}
          icon={group.icon}
          expandedIcon={group.expandedIcon}
          hoverIcon={group.hoverIcon}
          onToggleCollapsed={() => onGroupToggle(group.id)}
          action={groupAction ? (
            <SidebarActionIconButton
              action={groupAction}
              scope="workspace-group"
              itemId={group.id}
              onAction={onAction}
              alwaysVisible
            />
          ) : null}
        />
      ) : null}

      {(!group.collapsed || !shouldShowHeader) ? (
        <div className="flex w-full min-w-0 flex-col gap-px">
          {group.rows.map((row) => (
            <WorkspaceRow
              key={row.id}
              row={row}
              onSelect={onWorkspaceSelect}
              onAction={onAction}
              shortcutRevealVisible={shortcutRevealVisible}
            />
          ))}
          {group.rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">
              This repository has no workspaces yet.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface ProductSidebarRepoGroupHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick"> {
  label: string;
  count: number;
  collapsed: boolean;
  icon?: ReactNode;
  expandedIcon?: ReactNode;
  hoverIcon?: ReactNode;
  action?: ReactNode;
  onToggleCollapsed: () => void;
}

export function ProductSidebarRepoGroupHeader({
  label,
  count,
  collapsed,
  icon,
  expandedIcon,
  hoverIcon,
  action = null,
  onToggleCollapsed,
  className = "",
  ...props
}: ProductSidebarRepoGroupHeaderProps) {
  const visibleIcon = collapsed ? icon : (expandedIcon ?? icon);
  const hoverIconNode = hoverIcon ?? <ChevronGlyph collapsed={collapsed} />;
  const hasAction = action !== null && action !== undefined;

  return (
    <SidebarRowSurface
      onPress={onToggleCollapsed}
      aria-expanded={!collapsed}
      className={`group/folder-row h-[30px] justify-between overflow-x-hidden py-1 text-sm leading-4 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
        <span className="relative flex h-6 w-6 items-center justify-center text-sidebar-muted-foreground">
          {visibleIcon ? (
            <span className="flex items-center justify-center group-hover/folder-row:opacity-0">
              {visibleIcon}
            </span>
          ) : null}
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/folder-row:opacity-100">
            {hoverIconNode}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-base leading-5 text-current">
          {label}
        </span>

        <div className="relative ml-auto size-6 shrink-0">
          <span className={`absolute inset-0 flex items-center justify-center font-mono text-[0.625rem] text-sidebar-muted-foreground transition-opacity ${hasAction ? "group-hover/folder-row:opacity-0" : ""
            }`}>
            {count}
          </span>
          {hasAction ? (
            <div className="absolute inset-0 flex items-center justify-center gap-0.5 opacity-0 transition-opacity group-hover/folder-row:opacity-100 group-focus-within/folder-row:opacity-100">
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </SidebarRowSurface>
  );
}

function WorkspaceRow({
  row,
  onSelect,
  onAction,
  shortcutRevealVisible,
}: {
  row: SidebarWorkspaceRowView;
  onSelect: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
  shortcutRevealVisible: boolean;
}) {
  const hoverAction = row.actions.slice(0, 1).map((action) => (
    <SidebarActionIconButton
      key={action.id}
      action={action}
      scope="workspace"
      itemId={row.id}
      onAction={onAction}
      alwaysVisible
    />
  ));

  return (
    <ProductSidebarWorkspaceRow
      active={row.active}
      archived={row.archived}
      status={row.status}
      attentionStatus={row.attentionStatus}
      label={row.label}
      subtitle={row.subtitle}
      detail={row.detail}
      trailingLabel={row.trailingLabel}
      shortcutLabel={row.shortcutLabel}
      shortcutRevealVisible={shortcutRevealVisible}
      hoverAction={hoverAction.length > 0 ? hoverAction : null}
      onSelect={() => onSelect(row.id)}
    />
  );
}

export interface ProductSidebarWorkspaceRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  active?: boolean;
  archived?: boolean;
  status?: ReactNode;
  attentionStatus?: ReactNode;
  label: string;
  subtitle?: string | null;
  detail?: ReactNode;
  trailingLabel?: string | null;
  shortcutLabel?: string | null;
  shortcutRevealVisible?: boolean;
  hoverAction?: ReactNode;
  onSelect?: () => void;
}

export function ProductSidebarWorkspaceRow({
  active = false,
  archived = false,
  status = null,
  attentionStatus = null,
  label,
  subtitle = null,
  detail = null,
  trailingLabel = null,
  shortcutLabel = null,
  shortcutRevealVisible = false,
  hoverAction = null,
  onSelect,
  className = "",
  ...props
}: ProductSidebarWorkspaceRowProps) {
  const hasSubtitle = Boolean(subtitle);

  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className={`${hasSubtitle ? "h-[42px]" : "h-[30px]"} px-2 py-1 text-sm leading-4 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {hoverAction ? (
        <div className="absolute right-0 top-0 z-10 mr-0.5 flex h-full items-center justify-center pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {hoverAction}
        </div>
      ) : null}
      <div className="flex h-full w-full items-center text-sm leading-4">
        <div className="flex w-4 shrink-0 items-center justify-center">
          {status}
        </div>

        {attentionStatus ? (
          <div className="ml-1 flex w-3 shrink-0 items-center justify-center">
            {attentionStatus}
          </div>
        ) : null}

        <div className={`${attentionStatus ? "ml-1" : "ml-1.5"} flex min-w-0 flex-1 items-center gap-2 pl-0.5`}>
          <div className={`flex min-w-0 flex-1 self-stretch ${hasSubtitle ? "flex-col items-start justify-center gap-0.5" : "items-center gap-2"} text-base leading-5 ${archived ? "text-sidebar-muted-foreground/60" : "text-sidebar-foreground"
            }`}>
            <span
              className={`${hasSubtitle ? "max-w-full" : "min-w-0 flex-1"} truncate select-none`}
              draggable={false}
            >
              {label}
            </span>
            {hasSubtitle ? (
              <span className="max-w-full truncate text-xs leading-3 text-sidebar-muted-foreground select-none" draggable={false}>
                {subtitle}
              </span>
            ) : null}
          </div>
          {detail ? (
            <div className={`flex min-w-[24px] shrink-0 items-center justify-end gap-1.5 text-sidebar-muted-foreground`}>
              {detail}
            </div>
          ) : null}
        </div>

        {(trailingLabel || shortcutLabel || hoverAction) ? (
          <div className={`grid h-5 min-w-[26px] shrink-0 items-center justify-items-end ${detail ? "ml-[5px]" : "ml-1.5"
            }`}>

            {trailingLabel ? (
              <div className={`col-start-1 row-start-1 flex items-center justify-end overflow-visible truncate whitespace-nowrap text-right text-sm leading-4 tabular-nums text-sidebar-muted-foreground transition-opacity duration-150 ${shortcutLabel && shortcutRevealVisible
                  ? "opacity-0"
                  : "group-hover:opacity-0 group-focus-within:opacity-0"
                }`}>
                {trailingLabel}
              </div>
            ) : null}

            {shortcutLabel ? (
              <ShortcutBadge
                label={shortcutLabel}
                className={`col-start-1 row-start-1 h-fit !w-0 shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity duration-150 ${shortcutRevealVisible ? "opacity-100" : ""
                  }`}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </SidebarRowSurface>
  );
}

function ChevronGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      className={`block size-1.5 border-b border-r border-current transition-transform ${collapsed ? "-rotate-45" : "rotate-45"
        }`}
      aria-hidden="true"
    />
  );
}
