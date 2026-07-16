import { useQuery } from "@tanstack/react-query";
import { useCloudClient } from "@proliferate/cloud-sdk-react";

import {
  DISABLED_MOBILE_CAPABILITIES,
  parseMobileMetaCapabilities,
  type MobileServerCapabilities,
} from "../../../../lib/access/cloud/capabilities/mobile-server-capabilities";

/**
 * Read the connected control plane's v2 managed-Cloud / GitHub-access
 * capability status from `GET /meta`.
 *
 * Fail-closed: any error or malformed body resolves to fully-disabled
 * capabilities, so a gate never opens on unknown state. The query lives under
 * the cloud client's base URL so it re-fetches when the deployment changes.
 */
export function useMobileServerCapabilities(enabled = true) {
  const client = useCloudClient();
  return useQuery<MobileServerCapabilities>({
    queryKey: ["cloud", "meta-capabilities", client.baseUrl],
    queryFn: async () => {
      try {
        const body = await client.requestJson<unknown>({
          method: "GET",
          path: "/meta",
        });
        return parseMobileMetaCapabilities(body);
      } catch {
        return DISABLED_MOBILE_CAPABILITIES;
      }
    },
    enabled,
  });
}
