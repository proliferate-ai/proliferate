import { useEffect, useState } from "react";
import type {
  PluginInventoryItem,
  PluginSettings,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import type { CloudPluginsLocalOAuthAdapter } from "./cloud-plugin-surface-types";

export function useCloudPluginLocalOAuthStatuses(
  baseItems: readonly PluginInventoryItem[],
  localOAuthAdapter: CloudPluginsLocalOAuthAdapter | undefined,
): Record<string, "ready" | "not_ready"> {
  const [localOAuthStatuses, setLocalOAuthStatuses] = useState<Record<string, "ready" | "not_ready">>({});

  useEffect(() => {
    if (!localOAuthAdapter?.getCredentialStatus) {
      setLocalOAuthStatuses({});
      return;
    }
    const localItems = baseItems.filter((item) =>
      item.state === "installed"
      && item.setupVariant === "local_oauth"
      && item.connection
    );
    if (localItems.length === 0) {
      setLocalOAuthStatuses({});
      return;
    }
    let cancelled = false;
    void Promise.all(localItems.map(async (item) => {
      const status = await localOAuthAdapter.getCredentialStatus!({
        connectionId: item.connection!.connectionId,
        catalogEntryId: item.entry.id,
        settings: item.connection!.settings as PluginSettings | undefined,
      }).catch(() => "not_ready" as const);
      return [item.id, status] as const;
    })).then((entries) => {
      if (!cancelled) {
        setLocalOAuthStatuses(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [baseItems, localOAuthAdapter]);

  return localOAuthStatuses;
}
