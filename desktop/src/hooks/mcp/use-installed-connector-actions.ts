import { useCallback, useState } from "react";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { useToastStore } from "@/stores/toast/toast-store";
import { useToggleConnector } from "./use-toggle-connector";

export function useInstalledConnectorActions() {
  const showToast = useToastStore((state) => state.show);
  const [pendingConnectionIds, setPendingConnectionIds] = useState<Set<string>>(new Set());
  const toggleMutation = useToggleConnector();

  const setPending = useCallback((connectionId: string, active: boolean) => {
    setPendingConnectionIds((current) => {
      const next = new Set(current);
      if (active) {
        next.add(connectionId);
      } else {
        next.delete(connectionId);
      }
      return next;
    });
  }, []);

  const onToggle = useCallback(async (record: InstalledConnectorRecord, enabled: boolean) => {
    setPending(record.metadata.connectionId, true);
    try {
      await toggleMutation.mutateAsync({
        connectionId: record.metadata.connectionId,
        catalogEntryId: record.catalogEntry.id,
        enabled,
      });
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : `Couldn't update ${record.catalogEntry.name}. Try again.`,
      );
    } finally {
      setPending(record.metadata.connectionId, false);
    }
  }, [setPending, showToast, toggleMutation]);

  return {
    isPending: (connectionId: string) => pendingConnectionIds.has(connectionId),
    onToggle,
  };
}
