import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  ErrorContext,
  ProductAuthUser,
  ProductRouteChange,
  ProductSupportTelemetryContext,
} from "@proliferate/product-client/host/product-host";
import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";

/**
 * Emit a product telemetry event whose name and payload are compile-time
 * checked against the Desktop product event catalog. This is the single typed
 * seam plain (non-React) workflows accept as an injected dependency so they can
 * emit without importing the host provider or a vendor SDK.
 */
export type TrackProductEvent = <K extends keyof DesktopProductEventMap>(
  name: K,
  payload: DesktopProductEventMap[K],
) => void;

/**
 * The product-facing telemetry surface. Forwards to the mounted
 * `host.telemetry` (the one thin vendor adapter) through the shared
 * `ProductTelemetry` contract, exposing a `track` narrowed to the Desktop event
 * catalog. It contains no vendor import and no surface branch: product code
 * emits the same events on any host.
 */
export interface ProductTelemetryFacade {
  track: TrackProductEvent;
  captureException(error: unknown, context?: ErrorContext): void;
  setUser(user: ProductAuthUser | null): void;
  setTag(key: string, value: string): void;
  routeChanged(change: ProductRouteChange): void;
  getSupportContext(): ProductSupportTelemetryContext;
}

/**
 * Obtain the typed product telemetry adapter over the mounted ProductHost. The
 * concrete event catalog (`DesktopProductEventMap`) is owned by product code;
 * the open `ProductEvent` boundary carries the name/payload to the host without
 * the host importing the catalog.
 */
export function useProductTelemetry(): ProductTelemetryFacade {
  const telemetry = useProductHost().telemetry;
  return useMemo<ProductTelemetryFacade>(
    () => ({
      track(name, payload) {
        telemetry.track({
          name: name as string,
          properties: payload as Record<string, unknown> | undefined,
        });
      },
      captureException(error, context) {
        telemetry.captureException(error, context);
      },
      setUser(user) {
        telemetry.setUser(user);
      },
      setTag(key, value) {
        telemetry.setTag(key, value);
      },
      routeChanged(change) {
        telemetry.routeChanged(change);
      },
      getSupportContext() {
        return telemetry.getSupportContext();
      },
    }),
    [telemetry],
  );
}
