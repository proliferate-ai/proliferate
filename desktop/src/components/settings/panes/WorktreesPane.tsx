import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { WorktreeStorageSection } from "@/components/settings/panes/environments/WorktreeStorageSection";

export function WorktreesPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Worktrees"
        description="Manage local runtime storage, Proliferate-managed checkouts, cleanup, and workspace history."
      />
      <WorktreeStorageSection />
    </section>
  );
}
