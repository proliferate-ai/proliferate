import { useNavigate } from "react-router-dom";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { useSettingsNavigation } from "@/hooks/settings/use-settings-navigation";
import { useSettingsRepositories } from "@/hooks/settings/use-settings-repositories";

export function SettingsPage() {
  const navigate = useNavigate();
  const { repositories } = useSettingsRepositories();
  const {
    activeSection,
    activeRepoSourceRoot,
    selectSection,
    selectRepo,
  } = useSettingsNavigation({ repositories });

  return (
    <SettingsScreen
      activeSection={activeSection}
      activeRepoSourceRoot={activeRepoSourceRoot}
      repositories={repositories}
      onNavigateHome={() => navigate("/")}
      onSelectSection={selectSection}
      onSelectRepo={selectRepo}
    />
  );
}
