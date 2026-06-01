import {
  MobilePopover,
} from "../../primitives/popover/MobilePopover";
import { MobilePopoverDivider } from "../../primitives/popover/MobilePopoverDivider";
import { MobilePopoverGroup } from "../../primitives/popover/MobilePopoverGroup";
import { MobilePopoverOption } from "../../primitives/popover/MobilePopoverOption";
import { MobilePopoverRow } from "../../primitives/popover/MobilePopoverRow";

type MobileHomeRepoOption = {
  id: string;
  label: string;
  description?: string | null;
};

export function MobileHomeRepoPopover({
  visible,
  loading,
  repoOptions,
  selectedRepoId,
  onSelectRepo,
  onConfigureRepos,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  repoOptions: readonly MobileHomeRepoOption[];
  selectedRepoId: string | null;
  onSelectRepo: (repoId: string) => void;
  onConfigureRepos: () => void;
  onClose: () => void;
}) {
  return (
    <MobilePopover
      visible={visible}
      onClose={onClose}
      anchor="bottom-left"
      insetSide={20}
      insetBottom={140}
      width={300}
    >
      <MobilePopoverGroup>
        {loading ? (
          <MobilePopoverRow id="loading" icon="git-branch" title="Loading repositories..." disabled />
        ) : repoOptions.length === 0 ? (
          <MobilePopoverRow id="empty" icon="git-branch" title="No configured repositories" disabled />
        ) : (
          repoOptions.map((repo) => (
            <MobilePopoverOption
              key={repo.id}
              title={repo.label}
              subtitle={repo.description ?? undefined}
              selected={repo.id === selectedRepoId}
              onSelect={() => {
                onSelectRepo(repo.id);
                onClose();
              }}
            />
          ))
        )}
        <MobilePopoverDivider />
        <MobilePopoverRow
          id="configure-repos"
          icon="settings"
          title="Configure on GitHub"
          subtitle="Add or manage repos in Settings"
          onPress={() => {
            onClose();
            onConfigureRepos();
          }}
        />
      </MobilePopoverGroup>
    </MobilePopover>
  );
}
