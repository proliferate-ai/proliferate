import type { ReactNode } from "react";

import type {
  SidebarActionEvent,
  SidebarSectionMessageView,
  SidebarWorkspaceGroupView,
  SidebarWorkspaceRowView,
} from "./ProductSidebarModel";
import { SidebarActionIconButton } from "./ProductSidebarActionButton";
import { ProductSidebarSectionHeader } from "./ProductSidebarLayout";
import {
  ProductSidebarRepoGroupHeader,
  ProductSidebarWorkspaceRow,
} from "./ProductSidebarRepositories";

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
