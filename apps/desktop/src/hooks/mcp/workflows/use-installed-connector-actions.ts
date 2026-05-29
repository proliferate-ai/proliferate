import { useCallback, useState } from "react";
import { useSetConnectorPublicExposure } from "@/hooks/mcp/workflows/use-set-connector-public-exposure";
import { useToggleConnector } from "@/hooks/mcp/workflows/use-toggle-connector";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { useToastStore } from "@/stores/toast/toast-store";

export function useInstalledConnectorActions() {
  // Owns installed connector row actions and pending toggles. Does not own catalog modal state.
  const showToast = useToastStore((state) => state.show);
  const [pendingConnectionIds, setPendingConnectionIds] = useState<Set<string>>(new Set());
  const setPublicExposureMutation = useSetConnectorPublicExposure();
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

  const onSetSharedExposure = useCallback(async (
    record: InstalledConnectorRecord,
    organizationId: string,
    publicToOrg: boolean,
  ) => {
    setPending(record.metadata.connectionId, true);
    try {
      await setPublicExposureMutation.mutateAsync({
        record,
        organizationId,
        publicToOrg,
      });
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : `Couldn't update shared cloud access for ${record.catalogEntry.name}. Try again.`,
      );
    } finally {
      setPending(record.metadata.connectionId, false);
    }
  }, [setPending, setPublicExposureMutation, showToast]);

  return {
    isPending: (connectionId: string) => pendingConnectionIds.has(connectionId),
    onSetSharedExposure,
    onToggle,
  };
}
