import { SidebarBottomMenu } from "./SidebarBottomMenu";

/**
 * Main-sidebar footer (UX spec §2.5): codex account row opening the §9
 * settings popover. The organization switcher lives in Settings
 * (AppSidebarFooter is still used by the settings sidebar).
 */
export function SidebarFooter() {
  return <SidebarBottomMenu />;
}
