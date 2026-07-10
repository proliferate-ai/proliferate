import { useMemo } from "react";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { useAppCapabilities } from "./use-app-capabilities";

export interface WebAppTarget {
  /** Whether this deployment has a hosted web app to hand off to. */
  available: boolean;
  /** Runtime-resolved web base URL, or null when no web app is available. */
  baseUrl: string | null;
}

/**
 * Runtime-safe web-app handoff target.
 *
 * Web handoffs must never hardcode the vendor web origin: a self-managed
 * deployment has no hosted web app (`available` false → hide the affordance),
 * and the hosted product's web URL comes from the server contract when
 * declared, falling back to the build-time default only for the official host.
 */
export function useWebAppTarget(): WebAppTarget {
  const { webApp } = useAppCapabilities();

  return useMemo(() => {
    if (!webApp.available) {
      return { available: false, baseUrl: null };
    }
    return {
      available: true,
      baseUrl: webApp.baseUrl ?? getProliferateWebBaseUrl(),
    };
  }, [webApp.available, webApp.baseUrl]);
}
