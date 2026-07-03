import { useEffect, useMemo, useRef } from "react";
import { useAgentGatewayModelsQueries } from "@anyharness/sdk-react";
import { useMirrorAgentCatalog } from "@proliferate/cloud-sdk-react";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  planGatewayCatalogMirrorPushes,
  type GatewayModelsSnapshot,
} from "@/lib/domain/agents/gateway-catalog-mirror";

const GATEWAY_MIRROR_POLL_INTERVAL_MS = 60_000;

/**
 * Runtime -> cloud gateway-catalog mirror (P3 contract §4).
 *
 * The local AnyHarness runtime holds no cloud session — it's a passive local
 * HTTP server the desktop pushes INTO (agent-auth state.json) and reads FROM
 * (contract §5's `gateway-models` endpoint); see
 * `anyharness-lib/src/api/http/agent_auth.rs` and
 * `.../catalog/sync.rs`'s transport note. There is therefore no "runtime's
 * own cloud client" to fire the mirror push from, so the desktop plays that
 * role: poll the runtime's already-existing gateway-models endpoint per
 * harness (the same read the All-Models tab uses) and forward any FRESH
 * probe result to the cloud mirror endpoint.
 *
 * Fire-and-forget: a mirror push failure is logged and retried on the next
 * poll tick — it never surfaces to the user. Not signed in (`cloudActive`
 * false) or the runtime isn't reachable => the underlying queries are
 * disabled and nothing is pushed.
 */
export function useGatewayCatalogMirrorSync() {
  const { cloudActive } = useCloudAvailabilityState();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const runtimeHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const enabled = cloudActive && runtimeHealthy;

  const { readyAgentKinds } = useAgentCatalog();
  const harnessKinds = useMemo(
    () => Array.from(readyAgentKinds).sort(),
    [readyAgentKinds],
  );

  const queries = useAgentGatewayModelsQueries(harnessKinds, {
    enabled,
    refetchInterval: enabled ? GATEWAY_MIRROR_POLL_INTERVAL_MS : false,
  });
  const mirrorCatalog = useMirrorAgentCatalog();
  const lastMirroredProbedAtRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const pushes = planGatewayCatalogMirrorPushes({
      harnessKinds,
      snapshots: queries.map((query): GatewayModelsSnapshot | undefined => {
        const data = query.data;
        if (!data) {
          return undefined;
        }
        // Wire `source` is a plain string (`GatewayModelsResponse.source`);
        // narrow it here rather than widen the shared planning type.
        return {
          models: data.models,
          source: data.source === "probe" ? "probe" : "seed",
          probedAt: data.probedAt ?? undefined,
        };
      }),
      lastMirroredProbedAt: lastMirroredProbedAtRef.current,
    });
    pushes.forEach((push) => {
      // Record BEFORE the request resolves so a slow/failed mirror never
      // fires twice from the next poll tick landing mid-flight; a genuine
      // failure is retried once the gateway probes again (a new probedAt).
      lastMirroredProbedAtRef.current.set(push.harnessKind, push.probedAt);
      mirrorCatalog.mutate(
        {
          harnessKind: push.harnessKind,
          body: {
            surface: "local",
            route: "gateway",
            modelsJson: JSON.stringify(push.models),
            probedAt: push.probedAt,
          },
        },
        {
          onError: (error: unknown) => {
            console.debug(
              "[agent-gateway] catalog mirror push failed",
              push.harnessKind,
              error,
            );
          },
        },
      );
    });
  }, [enabled, harnessKinds, queries, mirrorCatalog]);
}
