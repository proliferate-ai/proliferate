import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { WorktreeStorageSection } from "#product/components/settings/panes/environments/WorktreeStorageSection";

export function WorktreesPane() {
  return (
    <SettingsPageBody>
      <PageHeader
        variant="flat"
        title="Pruning"
        description="Review worktree storage and prune stale checkouts."
      />
      <WorktreeStorageSection />
    </SettingsPageBody>
  );
}
