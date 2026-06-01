import type { ProductSidebarProps } from "./ProductSidebarModel";
import { AccountFooter, ProductSidebarFooter } from "./ProductSidebarFooter";
import {
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarHeader,
  ProductSidebarScrollableContent,
} from "./ProductSidebarLayout";
import { ProductSidebarPrimaryNavigation } from "./ProductSidebarNavigation";
import { ProductSidebarRepositoriesSection } from "./ProductSidebarRepositories";
import { ProductSidebarThreadSection } from "./ProductSidebarThreads";

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
export { ProductSidebarFooter } from "./ProductSidebarFooter";
export {
  ProductSidebarBody,
  ProductSidebarFrame,
  ProductSidebarScrollableContent,
  ProductSidebarSectionHeader,
} from "./ProductSidebarLayout";
export { ProductSidebarNavRow, ProductSidebarPrimaryNavigation } from "./ProductSidebarNavigation";
export {
  ProductSidebarRepoGroupHeader,
  ProductSidebarRepositoriesSection,
  ProductSidebarWorkspaceRow,
} from "./ProductSidebarRepositories";
export { ProductSidebarShowToggleRow } from "./ProductSidebarShowToggleRow";
export { ProductSidebarThreadRow, ProductSidebarThreadSection } from "./ProductSidebarThreads";

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
