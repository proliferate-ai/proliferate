import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { WorktreeStorageSection } from "@/components/settings/panes/environments/WorktreeStorageSection";

export function WorktreesPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Pruning"
        description="Review worktree storage and prune stale checkouts."
      />
      <WorktreeStorageSection />
    </section>
  );
}
