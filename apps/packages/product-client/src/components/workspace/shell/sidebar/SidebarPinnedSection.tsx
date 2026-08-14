import { ProductSidebarSectionHeader } from "#product/components/workspace/shell/sidebar/ProductSidebarLayout";
import {
  SidebarWorkspaceItems,
  type SidebarWorkspaceItemsProps,
} from "#product/components/workspace/shell/sidebar/SidebarWorkspaceItems";

/**
 * Pinned workspaces at the top of the sidebar, above the Repositories
 * section. Rows carry the full workspace-row action wiring; the section
 * renders nothing while no visible workspace is pinned.
 */
export function SidebarPinnedSection(props: SidebarWorkspaceItemsProps) {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="pb-2">
      <ProductSidebarSectionHeader label="Pinned" />
      <div className="flex w-full min-w-0 flex-col gap-px">
        <SidebarWorkspaceItems {...props} />
      </div>
    </div>
  );
}
