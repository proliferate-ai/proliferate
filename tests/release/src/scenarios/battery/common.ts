/**
 * Shared helpers for the staging battery (`T3-BATT-*`), the observe-mode
 * journeys ruled 2026-08-26 (delivery/testing-cicd/delivery-spec-e2e-observable.md).
 *
 * Every battery journey: staging-only, authenticates as the durable staging
 * user, asserts OUTCOMES (never transcripts), and never blocks anything — the
 * nightly digest reads the verdicts. Three journeys are expected to be red
 * today; they are still attempted for real, and an expected-fail is declared
 * ONLY when the observed failure matches the known gap's exact signature —
 * a status class alone is never a signature (refuter finding 4). Anything
 * else is a genuine red.
 */

import { ApiClient, ApiRequestError } from "../../fixtures/http.js";
import type { AuthSessionResponse } from "../../fixtures/identity.js";
import { assertDurableIdentityAvailableForLane, loginDurableUserForLane } from "../../fixtures/lane-identity.js";
import { ScenarioBlockedError, ScenarioExpectedFailError, type ScenarioRunContext } from "../types.js";

/**
 * The one registry pointer for the whole battery family: the frozen delivery
 * spec (merged #2272). The testing-system spec's release datasheet lands in a
 * parallel slice; pointing there before it exists would be a dangling ref in
 * every cell's evidence (refuter finding 11).
 */
export const BATTERY_FLOW_REF = "delivery/testing-cicd/delivery-spec-e2e-observable.md";

/** The seeded durable staging identity (staging_session_seed.py); env-overridable for other worlds. */
export const DURABLE_USER_EMAIL_DEFAULT = "support@proliferate.com";

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

/**
 * Durable-user login for the lane (staging rotates the seeded refresh token).
 * A 401 from the refresh route means the CREDENTIAL is dead (rotted bootstrap,
 * token_generation bump), not that seven product journeys regressed — report
 * blocked with the one-command fix, never seven reds (refuter finding 8).
 */
export async function authenticateBattery(scenarioId: string, ctx: ScenarioRunContext): Promise<BatterySession> {
  const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
  assertDurableIdentityAvailableForLane(scenarioId, ctx);
  let session: AuthSessionResponse;
  try {
    session = await loginDurableUserForLane(ctx, serverUrl);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
      throw new ScenarioBlockedError(
        `${scenarioId}: the staging durable-user session credential is invalid or expired (HTTP ${error.status} ` +
          "from /auth/mobile/session/refresh) — an ops credential problem, not a product verdict. Re-mint with " +
          "`tests/release/scripts/staging-session-remint.sh`.",
      );
    }
    throw error;
  }
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
    const code = errorCode(error);
    return `HTTP ${error.status}${code ? ` ${code}` : ""}`;
  }
  if (error instanceof Error) {
    return error.message.slice(0, 200);
  }
  return String(error).slice(0, 200);
}

/** The product error code carried in an ApiRequestError body (top-level or detail), if any. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiRequestError) || typeof error.body !== "object" || error.body === null) {
    return undefined;
  }
  const body = error.body as { code?: unknown; detail?: { code?: unknown } | string };
  if (typeof body.code === "string") {
    return body.code;
  }
  if (typeof body.detail === "string") {
    return body.detail;
  }
  if (typeof body.detail === "object" && body.detail !== null && typeof body.detail.code === "string") {
    return body.detail.code;
  }
  return undefined;
}

/** True when the error carries the exact product error code. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return errorCode(error) === code;
}

/**
 * "The route is not served by this deployment" — strictly absent surfaces
 * only (404/405/501). Generic 5xx is NOT this class: a 500 in a shipping
 * surface is a real red, and an ALB 502/503 mid-deploy is a real
 * infrastructure red the digest should show (refuter finding 4).
 */
export function isSurfaceAbsent(error: unknown): boolean {
  return error instanceof ApiRequestError && [404, 405, 501].includes(error.status);
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
