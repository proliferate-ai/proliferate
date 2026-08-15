import type { AvailableSessionCommand } from "@anyharness/sdk";
import { useSlashCommandCatalogStore } from "#product/stores/chat/slash-command-catalog-store";

const EMPTY: readonly AvailableSessionCommand[] = [];

/**
 * The launch-time stand-in for a live session's ACP command catalog: the most
 * recent catalog any session of the selected harness streamed, persisted
 * across app runs. Pre-creation there is no session to ask (PRO-228), so the
 * home composer's slash menu reads the last-seen catalog for the harness it
 * is about to launch.
 */
export function useHomeAvailableSlashCommands(
  agentKind: string | null,
): readonly AvailableSessionCommand[] {
  return useSlashCommandCatalogStore((state) => (
    agentKind ? state.catalogsByAgentKind[agentKind] : undefined
  )) ?? EMPTY;
}
