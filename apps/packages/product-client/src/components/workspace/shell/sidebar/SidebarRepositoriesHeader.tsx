import {
  Check,
  ChevronDownUp,
  ChevronUpDown,
  FolderPlus,
  ListFilter,
} from "@proliferate/ui/icons";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { SidebarActionButton } from "@proliferate/ui/layout/SidebarActionButton";
import { SidebarWorkspaceVariantIcon } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import { ProductSidebarSectionHeader } from "@proliferate/product-ui/sidebar/ProductSidebarLayout";
import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";

const SIDEBAR_WORKSPACE_TYPE_OPTIONS: Array<{
  label: string;
  variant: SidebarWorkspaceVariant;
}> = [
  { label: "Local", variant: "local" },
  { label: "Worktrees", variant: "worktree" },
  { label: "Cloud", variant: "cloud" },
  { label: "SSH targets", variant: "ssh" },
];

interface SidebarRepositoriesHeaderProps {
  hasRepoGroups: boolean;
  allRepoGroupsCollapsed: boolean;
  filtersActive: boolean;
  workspaceTypes: SidebarWorkspaceVariant[];
  onToggleAllRepoGroups: () => void;
  onToggleWorkspaceType: (variant: SidebarWorkspaceVariant) => void;
  onAddRepo: () => void;
}

export function SidebarRepositoriesHeader({
  hasRepoGroups,
  allRepoGroupsCollapsed,
  filtersActive,
  workspaceTypes,
  onToggleAllRepoGroups,
  onToggleWorkspaceType,
  onAddRepo,
}: SidebarRepositoriesHeaderProps) {
  return (
    <ProductSidebarSectionHeader
      label="Repositories"
      actions={(
        <>
          {hasRepoGroups && (
            <SidebarActionButton
              onClick={onToggleAllRepoGroups}
              title={allRepoGroupsCollapsed ? "Expand all repositories" : "Collapse all repositories"}
              variant="section"
            >
              {allRepoGroupsCollapsed ? (
                <ChevronUpDown className="icon-compact" />
              ) : (
                <ChevronDownUp className="icon-compact" />
              )}
            </SidebarActionButton>
          )}
          <PopoverButton
            trigger={
              <SidebarActionButton
                title="Filter workspaces"
                active={filtersActive}
                variant="section"
              >
                <ListFilter className="icon-compact" />
              </SidebarActionButton>
            }
          >
            {() => (
              <>
                {SIDEBAR_WORKSPACE_TYPE_OPTIONS.map(({ label, variant }) => {
                  const selected = workspaceTypes.includes(variant);
                  const disabled = selected && workspaceTypes.length === 1;

                  return (
                    <PopoverMenuItem
                      key={variant}
                      onClick={() => onToggleWorkspaceType(variant)}
                      disabled={disabled}
                      variant="sidebar"
                      icon={(
                        <SidebarWorkspaceVariantIcon
                          variant={variant}
                          className="icon-paired text-muted-foreground [font-size:var(--text-sidebar-row)]"
                        />
                      )}
                      label={label}
                      trailing={selected ? <Check className="icon-paired text-foreground/60" /> : null}
                    />
                  );
                })}
              </>
            )}
          </PopoverButton>
          <SidebarActionButton
            onClick={onAddRepo}
            title="Add repository"
            variant="section"
          >
            <FolderPlus className="icon-compact" />
          </SidebarActionButton>
        </>
      )}
    />
  );
}
