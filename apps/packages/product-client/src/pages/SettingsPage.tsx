import { useNavigate } from "react-router-dom";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { SettingsScreen } from "#product/components/settings/screen/SettingsScreen";
import { useShortcutHandler } from "#product/hooks/shortcuts/lifecycle/use-shortcut-handler";
import { hasOpenDismissableLayer } from "#product/lib/infra/dom/dismissable-layers";
import { useSettingsRepositories } from "#product/hooks/settings/derived/use-settings-repositories";
import { useSettingsNavigation } from "#product/hooks/settings/workflows/use-settings-navigation";

export function SettingsPage({ returnTo = "/" }: { returnTo?: string }) {
  const navigate = useNavigate();
  useShortcutHandler(SHORTCUTS.settingsBack.id, () => {
    if (hasOpenDismissableLayer()) {
      return false;
    }
    navigate(returnTo || "/");
  });
  const { repositories } = useSettingsRepositories();
  const {
    activeSection,
    activeRepoSourceRoot,
    focus,
    selectSection,
    selectRepo,
    selectRepoContext,
    selectCloudEnvironment,
  } = useSettingsNavigation({ repositories });

  return (
    <SettingsScreen
      activeSection={activeSection}
      activeRepoSourceRoot={activeRepoSourceRoot}
      focus={focus}
      repositories={repositories}
      onNavigateHome={() => navigate(returnTo || "/")}
      onSelectSection={selectSection}
      onSelectRepo={selectRepo}
      onSelectRepoContext={selectRepoContext}
      onSelectCloudEnvironment={selectCloudEnvironment}
    />
  );
}
