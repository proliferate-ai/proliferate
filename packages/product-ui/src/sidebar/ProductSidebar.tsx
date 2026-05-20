import {
  forwardRef,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from "react";

import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { SidebarRowSurface } from "@proliferate/ui/layout/SidebarRowSurface";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";

export interface SidebarNavItemView {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  status?: ReactNode;
  shortcutLabel?: string;
  disabled?: boolean;
}

export interface SidebarActionView {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}

export interface SidebarWorkspaceRowView {
  id: string;
  label: string;
  subtitle?: string | null;
  active: boolean;
  archived?: boolean;
  status?: ReactNode;
  detail?: ReactNode;
  trailingLabel?: string | null;
  shortcutLabel?: string | null;
  actions: SidebarActionView[];
}

export interface SidebarWorkspaceGroupView {
  id: string;
  sectionLabel?: string;
  label: string;
  count: number;
  collapsed: boolean;
  icon?: ReactNode;
  expandedIcon?: ReactNode;
  hoverIcon?: ReactNode;
  rows: SidebarWorkspaceRowView[];
  actions: SidebarActionView[];
}

export interface SidebarChatRowView {
  id: string;
  label: string;
  subtitle?: string | null;
  active?: boolean;
  status?: ReactNode;
  detail?: ReactNode;
  trailingLabel?: string | null;
  actions?: SidebarActionView[];
}

export interface SidebarAccountView {
  label: string;
  detail?: string | null;
  initials: string;
  avatarUrl?: string | null;
  actions?: SidebarActionView[];
}

export type SidebarActionScope = "nav" | "workspace-group" | "workspace" | "chat" | "account" | "header" | "footer";

export interface SidebarActionEvent {
  scope: SidebarActionScope;
  actionId: string;
  itemId?: string;
}

export interface ProductSidebarProps {
  className?: string;
  brand?: ReactNode;
  title?: string;
  showHeader?: boolean;
  headerAction?: SidebarActionView | null;
  navItems: SidebarNavItemView[];
  workspaceGroups: SidebarWorkspaceGroupView[];
  chatRows?: SidebarChatRowView[];
  account?: SidebarAccountView | null;
  footerActions?: SidebarActionView[];
  shortcutRevealVisible?: boolean;
  onNavSelect: (id: string) => void;
  onWorkspaceSelect: (id: string) => void;
  onChatSelect?: (id: string) => void;
  onGroupToggle: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
}

export function ProductSidebar({
  className = "",
  brand,
  title,
  showHeader,
  headerAction = null,
  navItems,
  workspaceGroups,
  chatRows = [],
  account = null,
  footerActions = [],
  shortcutRevealVisible = false,
  onNavSelect,
  onWorkspaceSelect,
  onChatSelect,
  onGroupToggle,
  onAction,
}: ProductSidebarProps) {
  const shouldShowHeader = showHeader ?? Boolean(brand || title);

  return (
    <ProductSidebarFrame
      className={`w-[280px] shrink-0 border-r border-sidebar-border ${className}`}
      footer={
        account ? (
          <AccountFooter account={account} onAction={onAction} />
        ) : footerActions.length > 0 ? (
          <ProductSidebarFooter actions={footerActions} onAction={onAction} />
        ) : null
      }
    >
      {shouldShowHeader ? (
        <ProductSidebarHeader
          brand={brand}
          title={title}
          headerAction={headerAction}
          onAction={onAction}
        />
      ) : null}
      <ProductSidebarBody>
        <ProductSidebarPrimaryNavigation
          navItems={navItems}
          onNavSelect={onNavSelect}
          shortcutRevealVisible={shortcutRevealVisible}
        />

        <ProductSidebarScrollableContent>
          {chatRows.length > 0 ? (
            <ProductSidebarThreadSection
              rows={chatRows}
              onChatSelect={onChatSelect}
              onAction={onAction}
            />
          ) : null}

          <ProductSidebarRepositoriesSection
            groups={workspaceGroups}
            onGroupToggle={onGroupToggle}
            onWorkspaceSelect={onWorkspaceSelect}
            onAction={onAction}
            shortcutRevealVisible={shortcutRevealVisible}
          />
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  );
}

export type SidebarActionButtonVariant = "default" | "section";

export interface SidebarActionButtonProps {
  children: ReactNode;
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  alwaysVisible?: boolean;
  active?: boolean;
  disabled?: boolean;
  variant?: SidebarActionButtonVariant;
}

export const SidebarActionButton = forwardRef<HTMLButtonElement, SidebarActionButtonProps>(
  function SidebarActionButton({
    children,
    title,
    onClick,
    className = "",
    alwaysVisible = false,
    active = false,
    disabled = false,
    variant = "default",
  }, ref) {
    const isAlwaysVisible = alwaysVisible || variant === "section";

    return (
      <IconButton
        ref={ref}
        tone="sidebar"
        size="sm"
        title={title}
        onClick={onClick}
        disabled={disabled}
        className={`size-6 rounded-md border border-transparent transition-all ${
          active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
        } ${
          isAlwaysVisible ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        } ${
          variant === "section"
            ? "opacity-75 hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            : ""
        } ${className}`}
      >
        {children}
      </IconButton>
    );
  },
);

export function ProductSidebarFrame({
  children,
  footer = null,
  className = "",
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex h-full flex-col gap-2 bg-sidebar-background pb-2 text-sidebar-foreground select-none ${className}`}>
      {children}
      {footer}
    </div>
  );
}

export function ProductSidebarBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </div>
  );
}

export function ProductSidebarScrollableContent({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <AutoHideScrollArea
        className="h-full"
        viewportClassName="px-2 pt-0.5 pb-4"
        contentClassName="flex w-full min-w-0 flex-col gap-px"
      >
        {children}
      </AutoHideScrollArea>
    </div>
  );
}

export function ProductSidebarPrimaryNavigation({
  navItems,
  onNavSelect,
  shortcutRevealVisible = false,
  className = "",
}: {
  navItems: SidebarNavItemView[];
  onNavSelect: (id: string) => void;
  shortcutRevealVisible?: boolean;
  className?: string;
}) {
  return (
    <nav className={`px-2 ${className}`}>
      <div className="flex flex-col gap-px">
        {navItems.map((item) => (
          <ProductSidebarNavRow
            key={item.id}
            item={item}
            onSelect={onNavSelect}
            shortcutRevealVisible={shortcutRevealVisible}
          />
        ))}
      </div>
    </nav>
  );
}

function ProductSidebarHeader({
  brand,
  title,
  headerAction,
  onAction,
}: {
  brand?: ReactNode;
  title?: string;
  headerAction?: SidebarActionView | null;
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 px-3">
      {brand ? (
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground">
          {brand}
        </div>
      ) : null}
      {title ? (
        <div className="min-w-0 flex-1 truncate text-base leading-5 text-sidebar-foreground">
          {title}
        </div>
      ) : <div className="min-w-0 flex-1" />}
      {headerAction ? (
        <SidebarActionIconButton
          action={headerAction}
          scope="header"
          onAction={onAction}
          alwaysVisible
        />
      ) : null}
    </div>
  );
}

export function ProductSidebarNavRow({
  item,
  onSelect,
  shortcutRevealVisible = false,
  className = "",
  ...props
}: {
  item: SidebarNavItemView;
  onSelect: (id: string) => void;
  shortcutRevealVisible?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect">) {
  return (
    <SidebarRowSurface
      as="button"
      active={item.active}
      disabled={item.disabled}
      onPress={() => onSelect(item.id)}
      className={`h-[30px] gap-1.5 px-2 py-1 text-sm leading-4 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      <div className="flex w-4 shrink-0 items-center justify-center">
        {item.icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-base leading-5 text-current">
        <span className="truncate">{item.label}</span>
      </div>
      {item.status ? (
        <span className="ml-auto shrink-0 text-xs leading-4 text-sidebar-muted-foreground">
          {item.status}
        </span>
      ) : item.shortcutLabel ? (
        <ShortcutBadge
          label={item.shortcutLabel}
          className={`shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity ${
            shortcutRevealVisible ? "opacity-100" : "group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        />
      ) : null}
    </SidebarRowSurface>
  );
}

function ProductSidebarThreadSection({
  rows,
  onChatSelect,
  onAction,
}: {
  rows: SidebarChatRowView[];
  onChatSelect?: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <section className="pb-2">
      <ProductSidebarSectionHeader label="Threads" />
      <div className="flex flex-col gap-px">
        {rows.map((row) => (
          <ChatRow
            key={row.id}
            row={row}
            onSelect={onChatSelect}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}

function ProductSidebarRepositoriesSection({
  groups,
  onGroupToggle,
  onWorkspaceSelect,
  onAction,
  shortcutRevealVisible,
}: {
  groups: SidebarWorkspaceGroupView[];
  onGroupToggle: (id: string) => void;
  onWorkspaceSelect: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
  shortcutRevealVisible: boolean;
}) {
  return (
    <section>
      <ProductSidebarSectionHeader label="Repositories" />
      <div className="flex flex-col gap-px">
        {groups.map((group) => (
          <WorkspaceGroup
            key={group.id}
            group={group}
            onGroupToggle={onGroupToggle}
            onWorkspaceSelect={onWorkspaceSelect}
            onAction={onAction}
            shortcutRevealVisible={shortcutRevealVisible}
          />
        ))}
      </div>
    </section>
  );
}

export function ProductSidebarSectionHeader({
  label,
  actions = null,
}: {
  label: string;
  actions?: ReactNode;
}) {
  return (
    <div className="pl-2 pt-3 pb-1 text-base leading-5 text-sidebar-muted-foreground opacity-75">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">
            {actions}
          </div>
        ) : null}
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

  return (
    <div className="w-full min-w-0">
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

      {!group.collapsed ? (
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
          <span className={`absolute inset-0 flex items-center justify-center font-mono text-[0.625rem] text-sidebar-muted-foreground transition-opacity ${
            hasAction ? "group-hover/folder-row:opacity-0" : ""
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
      label={row.label}
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
  label: string;
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
  label,
  detail = null,
  trailingLabel = null,
  shortcutLabel = null,
  shortcutRevealVisible = false,
  hoverAction = null,
  onSelect,
  className = "",
  ...props
}: ProductSidebarWorkspaceRowProps) {
  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className={`h-[30px] px-2 py-1 text-sm leading-4 focus-visible:outline-offset-[-2px] ${className}`}
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

        <div className="ml-1.5 flex min-w-0 flex-1 items-center gap-2 pl-0.5">
          <div className={`flex min-w-0 flex-1 self-stretch items-center gap-2 text-base leading-5 ${
            archived ? "text-sidebar-muted-foreground/60" : "text-sidebar-foreground"
          }`}>
            <span className="min-w-0 flex-1 truncate select-none" draggable={false}>
              {label}
            </span>
          </div>
          {detail ? (
            <div className={`flex min-w-[24px] shrink-0 items-center justify-end gap-1.5 text-sidebar-muted-foreground ${
              shortcutLabel ? "mr-2" : ""
            }`}>
              {detail}
            </div>
          ) : null}
        </div>

        {(trailingLabel || shortcutLabel || hoverAction) ? (
          <div className="ml-1.5 grid h-5 min-w-[26px] shrink-0 items-center justify-items-end">
            {trailingLabel ? (
              <div className={`col-start-1 row-start-1 flex items-center justify-end overflow-visible truncate whitespace-nowrap text-right text-sm leading-4 tabular-nums text-sidebar-muted-foreground transition-opacity duration-150 ${
                shortcutLabel && shortcutRevealVisible
                  ? "opacity-0"
                  : "group-hover:opacity-0 group-focus-within:opacity-0"
              }`}>
                {trailingLabel}
              </div>
            ) : null}
            {shortcutLabel ? (
              <ShortcutBadge
                label={shortcutLabel}
                className={`col-start-1 row-start-1 h-fit min-w-[30px] shrink-0 text-sidebar-muted-foreground opacity-0 transition-opacity duration-150 ${
                  shortcutRevealVisible ? "opacity-100" : ""
                }`}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </SidebarRowSurface>
  );
}

function ChatRow({
  row,
  onSelect,
  onAction,
}: {
  row: SidebarChatRowView;
  onSelect?: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
}) {
  const hoverAction = (row.actions ?? []).slice(0, 1).map((action) => (
    <SidebarActionIconButton
      key={action.id}
      action={action}
      scope="chat"
      itemId={row.id}
      onAction={onAction}
      alwaysVisible
    />
  ));

  return (
    <ProductSidebarThreadRow
      active={Boolean(row.active)}
      status={row.status}
      label={row.label}
      detail={row.detail}
      trailingLabel={row.trailingLabel}
      hoverAction={hoverAction.length > 0 ? hoverAction : null}
      onSelect={() => onSelect?.(row.id)}
    />
  );
}

export interface ProductSidebarThreadRowProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "onSelect"> {
  active?: boolean;
  status?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  trailingLabel?: string | null;
  hoverAction?: ReactNode;
  expandControl?: ReactNode;
  onSelect?: () => void;
}

export function ProductSidebarThreadRow({
  active = false,
  status = null,
  label,
  detail = null,
  trailingLabel = null,
  hoverAction = null,
  expandControl = null,
  onSelect,
  className = "",
  ...props
}: ProductSidebarThreadRowProps) {
  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className={`h-[30px] pl-2 pr-1 py-1 focus-visible:outline-offset-[-2px] ${className}`}
      {...props}
    >
      {hoverAction ? (
        <div className="absolute right-0 top-0 z-10 mr-0.5 flex h-full items-center justify-center pr-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {hoverAction}
        </div>
      ) : null}
      <div className="flex w-full items-center gap-1.5 text-sm leading-4">
        <div className="flex w-4 shrink-0 items-center justify-center">
          {status}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex flex-1 items-center gap-2 truncate text-base leading-5 text-sidebar-foreground">
            {label}
          </div>
          {detail ? (
            <div className="flex min-w-[24px] shrink-0 items-center justify-end gap-1 text-sidebar-muted-foreground">
              {detail}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {trailingLabel && !active && !expandControl ? (
            <div className="truncate text-right text-sm leading-4 tabular-nums text-sidebar-muted-foreground group-focus-within:opacity-0 group-hover:opacity-0">
              {trailingLabel}
            </div>
          ) : null}
          {expandControl}
        </div>
      </div>
    </SidebarRowSurface>
  );
}

export function ProductSidebarShowToggleRow({
  label,
  onClick,
}: {
  label: "Show more" | "Show less";
  onClick: () => void;
}) {
  return (
    <div className="pl-6 pr-2 pt-0.5 pb-1">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        onClick={onClick}
        className="rounded-full border border-transparent px-2 py-0.5 text-sm leading-[18px] text-sidebar-muted-foreground hover:text-sidebar-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-ring focus-visible:outline-offset-2"
      >
        {label}
      </Button>
    </div>
  );
}

function AccountFooter({
  account,
  onAction,
}: {
  account: SidebarAccountView;
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <div className="shrink-0 border-t border-sidebar-border/75 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-foreground">
          {account.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            account.initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-4 text-sidebar-foreground">
            {account.label}
          </div>
          {account.detail ? (
            <div className="truncate text-xs leading-4 text-sidebar-muted-foreground">
              {account.detail}
            </div>
          ) : null}
        </div>
        {(account.actions ?? []).map((action) => (
          <SidebarActionIconButton
            key={action.id}
            action={action}
            scope="account"
            onAction={onAction}
            alwaysVisible
          />
        ))}
      </div>
    </div>
  );
}

export function ProductSidebarFooter({
  actions,
  onAction,
}: {
  actions: SidebarActionView[];
  onAction: (event: SidebarActionEvent) => void;
}) {
  return (
    <div className="shrink-0">
      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-sidebar-border/75 px-3 py-2">
        {actions.map((action) => (
          <SidebarActionIconButton
            key={action.id}
            action={action}
            scope="footer"
            onAction={onAction}
            alwaysVisible
          />
        ))}
      </div>
    </div>
  );
}

function SidebarActionIconButton({
  action,
  scope,
  itemId,
  onAction,
  alwaysVisible = false,
}: {
  action: SidebarActionView;
  scope: SidebarActionScope;
  itemId?: string;
  onAction: (event: SidebarActionEvent) => void;
  alwaysVisible?: boolean;
}) {
  return (
    <SidebarActionButton
      title={action.label}
      alwaysVisible={alwaysVisible}
      disabled={action.disabled}
      onClick={(event) => {
        event.stopPropagation();
        onAction({ scope, itemId, actionId: action.id });
      }}
      className={`${
        action.destructive ? "text-destructive hover:text-destructive" : ""
      } ${alwaysVisible ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
    >
      {action.icon ?? <span className="text-[10px] leading-none">...</span>}
    </SidebarActionButton>
  );
}

function ChevronGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      className={`block size-1.5 border-b border-r border-current transition-transform ${
        collapsed ? "-rotate-45" : "rotate-45"
      }`}
      aria-hidden="true"
    />
  );
}
