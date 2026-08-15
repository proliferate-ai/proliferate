import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { fetchMinDesktopVersionGate } from "#product/lib/access/cloud/server-capabilities";
import { isDesktopVersionSupported } from "#product/lib/domain/capabilities/version-compat";
import { useAppVersion } from "#product/hooks/access/tauri/app/use-app-version";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { minDesktopVersionGateKey } from "#product/hooks/access/cloud/server-capabilities/query-keys";

export interface MinDesktopVersionBlockState {
  blocked: boolean;
  appVersion: string;
  minDesktopVersion: string;
}

/**
 * Boot-time + periodic (60s, piggybacking the same poll cadence as
 * `useServerCapabilities`) version-skew check against the CURRENTLY CONNECTED
 * server — not just the one-shot check the manual connect flow already runs.
 *
 * Blocking requires ALL of:
 *   - the server explicitly opted into enforcement (`minDesktopVersionEnforced`);
 *   - the connected server actually declared a well-formed `/meta` (self-hosted
 *     servers that fail the structural check never block, per `isServerMetaShape`
 *     partner `fetchMinDesktopVersionGate` returning `null`);
 *   - the desktop's own version is confidently older (`isDesktopVersionSupported`
 *     fail-opens on dev/unstamped sentinels and unparseable strings).
 *
 * Returns `null` while the app version or the gate query hasn't resolved yet,
 * so callers never flash a block screen before there's an answer.
 */
export function useMinDesktopVersionGate(): MinDesktopVersionBlockState | null {
  const apiBaseUrl = useProductHost().deployment.apiBaseUrl;
  const appVersionQuery = useAppVersion();
  const telemetry = useProductTelemetry();

  const gateQuery = useQuery({
    queryKey: minDesktopVersionGateKey(apiBaseUrl),
    queryFn: () => fetchMinDesktopVersionGate(apiBaseUrl),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const appVersion = appVersionQuery.data;
  const gate = gateQuery.data;

  const blocked = Boolean(
    appVersion
    && gate
    && gate.minDesktopVersionEnforced
    && !isDesktopVersionSupported(appVersion, gate.minDesktopVersion),
  );

  // Emit the block metric once per (appVersion, minDesktopVersion) pair
  // becoming blocked, not on every 60s re-poll that confirms the same state.
  const lastReportedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!blocked || !appVersion || !gate) {
      if (!blocked) {
        lastReportedKey.current = null;
      }
      return;
    }
    const key = `${appVersion}:${gate.minDesktopVersion}`;
    if (lastReportedKey.current === key) {
      return;
    }
    lastReportedKey.current = key;
    telemetry.track("desktop_minversion_block", {
      app_version: appVersion,
      min_desktop_version: gate.minDesktopVersion,
    });
  }, [blocked, appVersion, gate, telemetry]);

  if (!appVersion || gateQuery.isPending) {
    return null;
  }

  return {
    blocked,
    appVersion,
    minDesktopVersion: gate?.minDesktopVersion ?? appVersion,
  };
}
