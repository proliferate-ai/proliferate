import type { ReactNode } from "react";

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
  attentionStatus?: ReactNode;
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
  headerHidden?: boolean;
  icon?: ReactNode;
  expandedIcon?: ReactNode;
  hoverIcon?: ReactNode;
  rows: SidebarWorkspaceRowView[];
  actions: SidebarActionView[];
}

export interface SidebarSectionMessageView {
  title: string;
  description?: string | null;
  tone?: "default" | "danger";
  status?: ReactNode;
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
  headerLeadingAction?: SidebarActionView | null;
  headerAction?: SidebarActionView | null;
  navItems: SidebarNavItemView[];
  workspaceGroups: SidebarWorkspaceGroupView[];
  chatRows?: SidebarChatRowView[];
  account?: SidebarAccountView | null;
  footerActions?: SidebarActionView[];
  workspaceSectionLabel?: string;
  workspaceSectionActions?: ReactNode;
  workspaceSectionPanel?: ReactNode;
  workspaceSectionMessage?: SidebarSectionMessageView | null;
  shortcutRevealVisible?: boolean;
  onNavSelect: (id: string) => void;
  onWorkspaceSelect: (id: string) => void;
  onChatSelect?: (id: string) => void;
  onGroupToggle: (id: string) => void;
  onAction: (event: SidebarActionEvent) => void;
}
