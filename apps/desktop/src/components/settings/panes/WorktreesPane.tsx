import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { WorktreeStorageSection } from "@/components/settings/panes/environments/WorktreeStorageSection";

export function WorktreesPane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Pruning"
        description="Set worktree pressure reminders and manage checkouts, git status, storage, and workspace history."
      />
      <WorktreeStorageSection />
    </section>
  );
}
