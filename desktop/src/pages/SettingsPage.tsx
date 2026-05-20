import { useNavigate } from "react-router-dom";
import { SettingsScreen } from "@/components/settings/screen/SettingsScreen";
import { useSettingsRepositories } from "@/hooks/settings/derived/use-settings-repositories";
import { useSettingsNavigation } from "@/hooks/settings/workflows/use-settings-navigation";

export function SettingsPage({ returnTo = "/" }: { returnTo?: string }) {
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
      onNavigateHome={() => navigate(returnTo || "/")}
      onSelectSection={selectSection}
      onSelectRepo={selectRepo}
    />
  );
}
