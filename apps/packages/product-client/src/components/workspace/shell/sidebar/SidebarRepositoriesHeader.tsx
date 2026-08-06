import {
  Check,
  MoreHorizontal,
  Plus,
} from "#product/primitives/icons/core";
import { FolderPlus } from "#product/primitives/icons/workspace";
import { PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { SidebarActionButton } from "#product/primitives/patterns/SidebarActionButton";
import { SidebarWorkspaceVariantIcon } from "#product/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import { ProductSidebarSectionHeader } from "#product/components/workspace/shell/sidebar/ProductSidebarLayout";
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
  repositoriesCollapsed: boolean;
  filtersActive: boolean;
  workspaceTypes: SidebarWorkspaceVariant[];
  onToggleRepositoriesCollapsed: () => void;
  onToggleWorkspaceType: (variant: SidebarWorkspaceVariant) => void;
  onNewChat: () => void;
  onAddRepo: () => void;
}

export function SidebarRepositoriesHeader({
  repositoriesCollapsed,
  filtersActive,
  workspaceTypes,
  onToggleRepositoriesCollapsed,
  onToggleWorkspaceType,
  onNewChat,
  onAddRepo,
}: SidebarRepositoriesHeaderProps) {
  const header = (
    <div className="contents">
      <ProductSidebarSectionHeader
        label="Repositories"
        collapsed={repositoriesCollapsed}
        onToggleCollapsed={onToggleRepositoriesCollapsed}
        actions={(
          <div className="flex items-center gap-0.5">
            <PopoverButton
              trigger={(
                <SidebarActionButton
                  title="Repository options"
                  active={filtersActive}
                  variant="section"
                  className="size-4.5 [&_svg]:icon-compact"
                >
                  <MoreHorizontal className="icon-compact" />
                </SidebarActionButton>
              )}
            >
              {(close) => (
                <RepositoriesMenuContent
                  workspaceTypes={workspaceTypes}
                  onToggleWorkspaceType={onToggleWorkspaceType}
                  onAddRepo={onAddRepo}
                  onClose={close}
                />
              )}
            </PopoverButton>
            <SidebarActionButton
              onClick={onNewChat}
              title="New chat"
              variant="section"
              className="size-4.5 [&_svg]:icon-compact"
            >
              <Plus className="icon-compact" />
            </SidebarActionButton>
          </div>
        )}
      />
    </div>
  );

  return (
    <PopoverButton trigger={header} triggerMode="contextMenu" stopPropagation>
      {(close) => (
        <RepositoriesMenuContent
          workspaceTypes={workspaceTypes}
          onToggleWorkspaceType={onToggleWorkspaceType}
          onAddRepo={onAddRepo}
          onClose={close}
        />
      )}
    </PopoverButton>
  );
}

function RepositoriesMenuContent({
  workspaceTypes,
  onToggleWorkspaceType,
  onAddRepo,
  onClose,
}: {
  workspaceTypes: SidebarWorkspaceVariant[];
  onToggleWorkspaceType: (variant: SidebarWorkspaceVariant) => void;
  onAddRepo: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex min-h-6 items-center px-2.5 py-1 text-ui-sm text-muted-foreground">
        Show workspaces
      </div>
      {SIDEBAR_WORKSPACE_TYPE_OPTIONS.map(({ label, variant }) => {
        const selected = workspaceTypes.includes(variant);
        const disabled = selected && workspaceTypes.length === 1;
        return (
          <PopoverMenuItem
            key={variant}
            onClick={() => onToggleWorkspaceType(variant)}
            disabled={disabled}
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
      <div className="mx-1 my-1.5 h-px scale-y-50 bg-border" />
      <PopoverMenuItem
        icon={<FolderPlus className="icon-paired text-muted-foreground" />}
        label="Add repository…"
        onClick={() => {
          onClose();
          onAddRepo();
        }}
      />
    </>
  );
}
