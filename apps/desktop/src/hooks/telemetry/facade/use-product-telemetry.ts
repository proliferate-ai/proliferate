import { useMemo } from "react";
import type {
  ErrorContext,
  ProductAuthUser,
  ProductRouteChange,
  ProductSupportTelemetryContext,
  ProductTelemetry,
} from "@proliferate/product-client/host/product-host";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";

export type TrackProductEvent = <K extends keyof DesktopProductEventMap>(
  name: K,
  properties: DesktopProductEventMap[K],
) => void;

export interface ProductTelemetryFacade {
  track: TrackProductEvent;
  captureException(error: unknown, context?: ErrorContext): void;
  setUser(user: ProductAuthUser | null): void;
  setTag(key: string, value: string): void;
  routeChanged(change: ProductRouteChange): void;
  getSupportContext(): ProductSupportTelemetryContext;
}

/**
 * Product-owned, event-catalog-typed access to the mounted host transport.
 * Vendor initialization, routing, and privacy policy remain host-owned.
 */
export function useProductTelemetry(): ProductTelemetryFacade {
  const telemetry = useProductHost().telemetry;

  return useMemo(() => createProductTelemetryFacade(telemetry), [telemetry]);
}

export function createProductTelemetryFacade(
  telemetry: ProductTelemetry,
): ProductTelemetryFacade {
  const track: TrackProductEvent = (name, properties) => {
    telemetry.track({
      name,
      ...(properties === undefined
        ? {}
        : { properties: properties as Record<string, unknown> }),
    });
  };

  return {
    track,
    captureException: (error, context) => {
      telemetry.captureException(error, context);
    },
    setUser: (user) => {
      telemetry.setUser(user);
    },
    setTag: (key, value) => {
      telemetry.setTag(key, value);
    },
    routeChanged: (change) => {
      telemetry.routeChanged(change);
    },
    getSupportContext: () => telemetry.getSupportContext(),
  };
}
