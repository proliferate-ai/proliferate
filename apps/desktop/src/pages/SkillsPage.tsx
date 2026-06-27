import { SkillsScreen } from "@/components/skills/screen/SkillsScreen";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";

export function SkillsPage() {
  return (
    <MainSidebarPageShell>
      <SkillsScreen />
    </MainSidebarPageShell>
  );
}
