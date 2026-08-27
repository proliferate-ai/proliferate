/**
 * Shared helpers for the staging battery (`T3-BATT-*`), the observe-mode
 * journeys ruled 2026-08-26 (delivery/testing-cicd/delivery-spec-e2e-observable.md;
 * specs/engineering/testing/release.md "What an e2e scenario is").
 *
 * Every battery journey: staging-only, authenticates as the durable staging
 * user, asserts OUTCOMES (never transcripts), and never blocks anything — the
 * nightly digest reads the verdicts. Three journeys are expected to be red
 * today; they are still attempted for real, and an expected-fail is declared
 * ONLY when the observed failure matches the known gap's signature — any other
 * failure is a genuine red (`ScenarioExpectedFailError` semantics, types.ts).
 */

import { ApiClient, ApiRequestError } from "../../fixtures/http.js";
import type { AuthSessionResponse } from "../../fixtures/identity.js";
import { assertDurableIdentityAvailableForLane, loginDurableUserForLane } from "../../fixtures/lane-identity.js";
import { ScenarioBlockedError, ScenarioExpectedFailError, type ScenarioRunContext } from "../types.js";

/** The one registry pointer for the whole battery family. */
export const BATTERY_FLOW_REF = "specs/engineering/testing/release.md#what-an-e2e-scenario-is";

export interface BatterySession {
  serverUrl: string;
  session: AuthSessionResponse;
  /** Bearer-authenticated client for prefix-relative product routes (/v1/…). */
  client: ApiClient;
}

/** Battery journeys assert a real deployment; the local lane is covered elsewhere. */
export function assertStagingLane(scenarioId: string, ctx: ScenarioRunContext): void {
  if (ctx.targetLane !== "staging") {
    throw new ScenarioBlockedError(
      `${scenarioId}: staging battery journey — asserts the real staging deployment. Run with \`--lane staging\`.`,
    );
  }
}

/** Durable-user login for the lane (staging rotates the seeded refresh token). */
export async function authenticateBattery(scenarioId: string, ctx: ScenarioRunContext): Promise<BatterySession> {
  const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
  assertDurableIdentityAvailableForLane(scenarioId, ctx);
  const session = await loginDurableUserForLane(ctx, serverUrl);
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);
  return { serverUrl, session, client };
}

export function durableOrgId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.RELEASE_E2E_DURABLE_ORG_ID?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Bounded, secret-free description of a failure for reasons and logs. */
export function describeFailure(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const body = error.body;
    const code =
      typeof body === "object" && body !== null
        ? ((body as { code?: unknown; detail?: { code?: unknown } | string }).code ??
          (typeof (body as { detail?: unknown }).detail === "object"
            ? ((body as { detail?: { code?: unknown } }).detail?.code ?? null)
            : (body as { detail?: unknown }).detail))
        : null;
    return `HTTP ${error.status}${code ? ` ${String(code)}` : ""}`;
  }
  if (error instanceof Error) {
    return error.message.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

/**
 * "The surface is not served by this deployment" — the failure class the
 * known gaps (no worker plane on staging; the cloud session path) produce.
 * A 401/403 or a 4xx validation error is NOT this class: those are real reds.
 */
export function isSurfaceUnavailable(error: unknown): boolean {
  return error instanceof ApiRequestError && [404, 405, 500, 501, 502, 503, 504].includes(error.status);
}

/**
 * Rethrows `error` as an expected-fail when it matches the known gap's
 * signature; otherwise rethrows it unchanged (a genuine red).
 */
export function rethrowAsExpectedFail(
  scenarioId: string,
  error: unknown,
  matches: (error: unknown) => boolean,
  diagnosis: string,
): never {
  if (matches(error)) {
    throw new ScenarioExpectedFailError(`${scenarioId}: ${diagnosis} (observed: ${describeFailure(error)})`);
  }
  throw error;
}

/** Cheapest capable model among the observed ids, for the bounded agent turn. */
export function cheapestModel(ids: readonly string[]): string | undefined {
  const tier = (id: string): number => {
    if (/fable/i.test(id)) return 99;
    if (/haiku|mini|flash|nano/i.test(id)) return 0;
    if (/sonnet/i.test(id)) return 1;
    return 2;
  };
  return [...ids].sort((a, b) => tier(a) - tier(b))[0];
}

export function battRunId(): string {
  return `t3-batt-${Date.now().toString(36)}`;
}
