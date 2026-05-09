import {
  Archive,
  Check,
  CollapseAll,
  ExpandAll,
  Filter,
  FolderPlusFilled,
} from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { SidebarActionButton } from "@/components/workspace/shell/sidebar/SidebarActionButton";
import { SidebarWorkspaceVariantIcon } from "@/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";

const SIDEBAR_WORKSPACE_TYPE_OPTIONS: Array<{
  label: string;
  variant: SidebarWorkspaceVariant;
}> = [
  { label: "Local", variant: "local" },
  { label: "Worktrees", variant: "worktree" },
  { label: "Cloud", variant: "cloud" },
];

interface SidebarRepositoriesHeaderProps {
  hasRepoGroups: boolean;
  allRepoGroupsCollapsed: boolean;
  filtersActive: boolean;
  showArchived: boolean;
  workspaceTypes: SidebarWorkspaceVariant[];
  onToggleAllRepoGroups: () => void;
  onToggleShowArchived: () => void;
  onToggleWorkspaceType: (variant: SidebarWorkspaceVariant) => void;
  onAddRepo: () => void;
}

export function SidebarRepositoriesHeader({
  hasRepoGroups,
  allRepoGroupsCollapsed,
  filtersActive,
  showArchived,
  workspaceTypes,
  onToggleAllRepoGroups,
  onToggleShowArchived,
  onToggleWorkspaceType,
  onAddRepo,
}: SidebarRepositoriesHeaderProps) {
  return (
    <div className="text-foreground/50 text-base opacity-75 pl-2 pt-3 pb-1">
      <div className="flex items-center justify-between gap-2">
        <span>Repositories</span>
        <div className="flex shrink-0 items-center gap-1">
          {hasRepoGroups && (
            <SidebarActionButton
              onClick={onToggleAllRepoGroups}
              title={allRepoGroupsCollapsed ? "Expand all repositories" : "Collapse all repositories"}
              variant="section"
            >
              {allRepoGroupsCollapsed ? (
                <ExpandAll className="size-3" />
              ) : (
                <CollapseAll className="size-3" />
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
                <PopoverMenuItem
                  onClick={onToggleShowArchived}
                  variant="sidebar"
                  icon={<Archive className="size-3.5 text-muted-foreground" />}
                  label="Archived workspaces"
                  trailing={showArchived ? <Check className="size-3.5 text-foreground/60" /> : null}
                />
                <div className="my-1 h-px bg-border" />
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
            <FolderPlusFilled className="size-3" />
          </SidebarActionButton>
        </div>
      </div>
    </div>
  );
}
