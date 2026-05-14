import {
  Calendar,
  CircleQuestion,
  Grid,
  Home,
} from "@/components/ui/icons";
import { SidebarNavRow } from "@/components/ui/SidebarNavRow";
import { SHORTCUTS } from "@/config/shortcuts";

interface SidebarPrimaryNavigationProps {
  homeActive: boolean;
  pluginsActive: boolean;
  automationsActive: boolean;
  supportActive: boolean;
  onGoHome: () => void;
  onGoPlugins: () => void;
  onGoAutomations: () => void;
  onOpenSupport: () => void;
}

export function SidebarPrimaryNavigation({
  homeActive,
  pluginsActive,
  automationsActive,
  supportActive,
  onGoHome,
  onGoPlugins,
  onGoAutomations,
  onOpenSupport,
}: SidebarPrimaryNavigationProps) {
  return (
    <div className="px-2">
      <div className="flex flex-col gap-px">
        <SidebarNavRow
          active={homeActive}
          icon={<Home className="size-4" />}
          label="Home"
          shortcutLabel={SHORTCUTS.goHome.label}
          onPress={onGoHome}
        />
        <SidebarNavRow
          active={pluginsActive}
          icon={<Grid className="size-4" />}
          label="Plugins"
          onPress={onGoPlugins}
        />
        <SidebarNavRow
          active={automationsActive}
          icon={<Calendar className="size-4" />}
          label="Automations"
          onPress={onGoAutomations}
        />
        <SidebarNavRow
          active={supportActive}
          icon={<CircleQuestion className="size-4" />}
          label="Support"
          onPress={onOpenSupport}
        />
      </div>
    </div>
  );
}
