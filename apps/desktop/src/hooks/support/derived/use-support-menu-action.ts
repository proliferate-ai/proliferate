import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";
import {
  deriveSupportMenuAction,
  type SupportMenuAction,
} from "@/lib/domain/support/support-menu-action";

/**
 * What the sidebar/command-palette support action should do for the
 * connected server: keep the vendor feedback flow on hosted, route to the
 * operator's configured destination on a self-managed server that has one,
 * or offer no support action at all when nothing is configured.
 */
export function useSupportMenuAction(): SupportMenuAction {
  const { support } = useAppCapabilities();
  return deriveSupportMenuAction(support);
}
