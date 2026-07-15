import * as Sentry from "@sentry/react";
import posthog from "posthog-js";
import { Routes } from "react-router-dom";
import {
  scrubTelemetryData,
  scrubTelemetryText,
} from "@proliferate/product-domain/telemetry/scrub";
import type {
  ErrorContext,
  ProductAuthUser,
  ProductEvent,
  ProductRouteChange,
  ProductSupportTelemetryContext,
  ProductTelemetry,
} from "@proliferate/product-client/host/product-host";

/**
 * The Web `host.telemetry` adapter: the vendor transport (Sentry + PostHog)
 * implementing the shared {@link ProductTelemetry} contract. ProductClient emits
 * the same product events on both hosts and owns route classification and the
 * single `screen_viewed` event; this adapter only forwards to the vendors and
 * owns their lifecycle. It imports no product route taxonomy.
 *
 * Vendor initialization (Sentry in `main.tsx`, PostHog in the telemetry
 * provider) is idempotent and guarded elsewhere; every method here tolerates an
 * uninitialized vendor so telemetry-disabled builds are a no-op.
 */

/**
 * The Sentry-instrumented `Routes` container the Web host passes to
 * `ProductClient` as its required `RoutesComponent`. Wrapping React Router's
 * `Routes` with Sentry's v7 routing instrumentation keeps route/navigation
 * spans host-owned so ProductClient never imports Sentry. It falls back to the
 * plain `Routes` if the Sentry wrapper is unavailable (e.g. telemetry disabled).
 */
export const InstrumentedRoutes = (() => {
  try {
    return Sentry.withSentryReactRouterV7Routing(Routes);
  } catch {
    return Routes;
  }
})();

function webTelemetryRelease(): string {
  const release = import.meta.env.VITE_PROLIFERATE_RELEASE;
  return typeof release === "string" && release.length > 0
    ? release
    : "proliferate-web";
}

export const webProductTelemetry: ProductTelemetry = {
  track({ name, properties }: ProductEvent): void {
    if (!posthog.__loaded) {
      return;
    }
    posthog.capture(name, properties ? scrubTelemetryData(properties) : undefined);
  },

  captureException(error: unknown, context?: ErrorContext): void {
    Sentry.captureException(error, {
      tags: context?.tags,
      extra: context?.extras,
      level: context?.level,
      fingerprint: context?.fingerprint,
    });
  },

  setUser(user: ProductAuthUser | null): void {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.email ?? undefined });
      if (posthog.__loaded) {
        const properties: Record<string, string> = {};
        if (user.email) {
          properties.email = user.email;
        }
        if (user.displayName) {
          properties.display_name = user.displayName;
        }
        posthog.identify(user.id, scrubTelemetryData(properties));
      }
      return;
    }
    Sentry.setUser(null);
    if (posthog.__loaded) {
      posthog.reset(true);
    }
  },

  setTag(key: string, value: string): void {
    Sentry.setTag(key, value);
  },

  routeChanged(change: ProductRouteChange): void {
    // Host-owned vendor navigation metadata only. ProductClient owns route
    // classification, screen-view dedup, and the single product screen event;
    // this adapter attaches the already-classified route id to the vendor and
    // emits no product event. The raw pathname is not re-classified or sent.
    Sentry.setTag("route", change.routeId);
  },

  getSupportContext(): ProductSupportTelemetryContext {
    const context: ProductSupportTelemetryContext = {
      clientReleaseId: webTelemetryRelease(),
    };
    if (posthog.__loaded) {
      const distinctId = posthog.get_distinct_id();
      const sessionId = posthog.get_session_id?.();
      context.telemetryRefs = {
        ...(distinctId ? { posthogDistinctId: scrubTelemetryText(distinctId) } : {}),
        ...(sessionId ? { posthogSessionId: scrubTelemetryText(sessionId) } : {}),
      };
    }
    return context;
  },

  async getAnonymousInstallId(): Promise<string | null> {
    // Hosted Web has no anonymous-telemetry bootstrap (that install id is a
    // Desktop concept, distinct from the Desktop worker install id). Consumers
    // omit the field on null, matching the prior behavior.
    return null;
  },
};
