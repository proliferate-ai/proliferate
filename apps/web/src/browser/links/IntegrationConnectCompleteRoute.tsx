import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  buildDesktopDeepLink,
  decodeWebIntegrationComplete,
  emitWebInboundEntry,
} from "./web-product-links";

/**
 * The narrow `/plugins/connect/complete` host route: the integration/MCP OAuth
 * completion decoder. It validates `source` (dropping anything unrecognized),
 * then routes the normalized `integration-callback` entry by `finalSurface`:
 * emit it to ProductClient when the final surface is Web, or hand the same entry
 * to a running Desktop app via a `proliferate://plugins` deep link when the
 * final surface is Desktop. It never exposes OAuth tokens — only the classified
 * `source`/`status`/`flowId`/`failureCode` cross into the entry.
 */
export function IntegrationConnectCompleteRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;

    const entry = decodeWebIntegrationComplete(new URL(window.location.href));
    if (entry === null || entry.kind !== "integration-callback") {
      // Unrecognized/malformed completion never becomes a product route.
      navigate("/", { replace: true });
      return;
    }

    if (searchParams.get("finalSurface") === "desktop") {
      const params = new URLSearchParams();
      params.set("source", entry.source);
      if (entry.status) {
        params.set("status", entry.status);
      }
      if (entry.flowId) {
        params.set("flowId", entry.flowId);
      }
      if (entry.failureCode) {
        params.set("failureCode", entry.failureCode);
      }
      window.location.replace(
        buildDesktopDeepLink("plugins", `?${params.toString()}`),
      );
      return;
    }

    emitWebInboundEntry(entry);
    navigate("/settings/integrations", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
