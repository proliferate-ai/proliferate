import type { ReactNode } from "react";
import {
  Calendar,
  CircleQuestion,
  Grid,
  Home,
} from "@/components/ui/icons";
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";

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
        <SidebarPrimaryNavigationRow
          active={homeActive}
          icon={<Home className="size-3" />}
          label="Home"
          onPress={onGoHome}
        />
        <SidebarPrimaryNavigationRow
          active={pluginsActive}
          icon={<Grid className="size-4" />}
          label="Plugins"
          onPress={onGoPlugins}
        />
        <SidebarPrimaryNavigationRow
          active={automationsActive}
          icon={<Calendar className="size-4" />}
          label="Automations"
          onPress={onGoAutomations}
        />
        <SidebarPrimaryNavigationRow
          active={supportActive}
          icon={<CircleQuestion className="size-4" />}
          label="Support"
          onPress={onOpenSupport}
        />
      </div>
    </div>
  );
}

function SidebarPrimaryNavigationRow({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <SidebarRowSurface
      active={active}
      onPress={onPress}
      className="h-[30px] px-2 py-1 gap-1.5 text-sm leading-4 focus-visible:outline-offset-[-2px]"
    >
      <div className="flex w-4 shrink-0 items-center justify-center">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 items-center text-base leading-5 text-foreground">
        <span className="truncate">{label}</span>
      </div>
    </SidebarRowSurface>
  );
}
