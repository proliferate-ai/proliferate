import {
  Check,
  ChevronDownUp,
  ChevronUpDown,
  Filter,
  FolderPlus,
} from "@proliferate/ui/icons";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { SidebarActionButton } from "@proliferate/ui/layout/SidebarActionButton";
import { SidebarWorkspaceVariantIcon } from "@/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import { ProductSidebarSectionHeader } from "@proliferate/product-ui/sidebar/ProductSidebarLayout";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";

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
                <ChevronUpDown className="size-3" />
              ) : (
                <ChevronDownUp className="size-3" />
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
                <Filter className="size-3" />
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
                          className="size-3.5 text-muted-foreground"
                        />
                      )}
                      label={label}
                      trailing={selected ? <Check className="size-3.5 text-foreground/60" /> : null}
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
            <FolderPlus className="size-3" />
          </SidebarActionButton>
        </>
      )}
    />
  );
}
