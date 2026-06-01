import type { ProductSidebarProps } from "./ProductSidebarModel";
import { AccountFooter } from "./ProductSidebarAccountFooter";
import { ProductSidebarFooter } from "./ProductSidebarFooter";
import {
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarScrollableContent,
} from "./ProductSidebarLayout";
import { ProductSidebarHeader } from "./ProductSidebarHeader";
import { ProductSidebarPrimaryNavigation } from "./ProductSidebarNavigation";
import { ProductSidebarRepositoriesSection } from "./ProductSidebarRepositoriesSection";
import { ProductSidebarThreadSection } from "./ProductSidebarThreadSection";

export type {
  ProductSidebarProps,
  SidebarAccountView,
  SidebarActionEvent,
  SidebarActionScope,
  SidebarActionView,
  SidebarChatRowView,
  SidebarNavItemView,
  SidebarSectionMessageView,
  SidebarWorkspaceGroupView,
  SidebarWorkspaceRowView,
} from "./ProductSidebarModel";

export function ProductSidebar({
  className = "",
  brand,
  title,
  showHeader,
  headerLeadingAction = null,
  headerAction = null,
  navItems,
  workspaceGroups,
  chatRows = [],
  account = null,
  footerActions = [],
  workspaceSectionLabel = "Repositories",
  workspaceSectionActions = null,
  workspaceSectionPanel = null,
  workspaceSectionMessage = null,
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
          headerLeadingAction={headerLeadingAction}
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
          <ProductSidebarRepositoriesSection
            label={workspaceSectionLabel}
            actions={workspaceSectionActions}
            panel={workspaceSectionPanel}
            groups={workspaceGroups}
            message={workspaceSectionMessage}
            onGroupToggle={onGroupToggle}
            onWorkspaceSelect={onWorkspaceSelect}
            onAction={onAction}
            shortcutRevealVisible={shortcutRevealVisible}
          />

          {chatRows.length > 0 ? (
            <ProductSidebarThreadSection
              rows={chatRows}
              onChatSelect={onChatSelect}
              onAction={onAction}
            />
          ) : null}
        </ProductSidebarScrollableContent>
      </ProductSidebarBody>
    </ProductSidebarFrame>
  );
}
