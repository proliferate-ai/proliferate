// T2-SH-7 (specs/developing/testing/self-hosting.md): gateway model
// eligibility — a gateway-routed context (agent-auth state pushed with only
// a `gateway` source, no native CLI login) REJECTS session creation with a
// bare native model selector (e.g. "default") and ACCEPTS a real
// gateway-catalog model id.
//
// The pure gating logic already has a unit test: `catalog::service_tests::
// gateway_context_gates_native_ids_and_offers_only_gateway_models`
// (anyharness/crates/anyharness-lib/src/domains/agents/catalog). This is the
// integration layer above it: does the REAL runtime, reached over its actual
// HTTP API after a REAL agent-auth state push, actually reject the
// ineligible id and accept the eligible one? No LLM call is made or needed —
// session *creation* is the runtime's own validation gate, entirely before
// any prompt/turn, so this respects the no-mock-LLM tier-2 rule by simply
// never invoking a model (this suite never sends a prompt).
//
// Deliberately narrower than tests/release/src/scenarios/t3-gw-1.ts (T3-GW-1):
// that scenario proves the REAL streamed-turn positive path against a real
// gateway (needs RELEASE_E2E_GATEWAY_TEST_KEY/_BASE_URL) and explicitly
// leaves the "does not offer an ineligible model" negative to the unit test,
// because the runtime's *offered candidate list* depends on ambient env (a
// dev box with a real native CLI login could legitimately also list native
// ids). Whether a specific id is *accepted* has no such dependency: a
// gateway-only route (freshly pushed, no native creds in this fresh
// runtime-home) either lets a session through or it doesn't, deterministic
// regardless of ambient env — so the negative closes here instead, with a
// synthetic/fake gateway base_url+key (agent-auth state is a stored
// document, not validated live on push; no real gateway is contacted, since
// no prompt is ever sent).
//
// Runtime dependency, named rather than hidden: the required Tier-2 workflow
// boots the local AnyHarness runtime. If it cannot build, start, or serve this
// seam, setup fails instead of converting the scenario into a green skip.
// `installAgent` may fetch the real CLI package on a cold runtime-home (the
// same cost tests/release's T3 scenarios already pay routinely).

import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anyharnessBaseUrl } from "../stack/seed.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// The checked-out monorepo itself is a real git repo already on disk — reuse
// it as the local workspace path so this suite never needs to clone
// anything over the network.
const REPO_ROOT = path.resolve(here, "..", "..", "..");

const HARNESS_KIND = "claude";
const INELIGIBLE_NATIVE_MODEL_ID = "default";
// A concrete catalog id tagged availability:["gateway"] for claude (matches
// t3-gw-1.ts's GATEWAY_MODEL_CANDIDATES) — never exercised for a real
// completion here, only offered to session creation's validation gate.
const ELIGIBLE_GATEWAY_MODEL_ID = "claude-haiku-4-5";

async function runtimeFetch(
  baseUrl: string,
  method: string,
  runtimePath: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${runtimePath}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

test.describe("T2-SH-7: gateway model eligibility — session creation gates native ids, accepts gateway ids", () => {
  let workspaceId: string;

  test.beforeAll(async () => {
    const baseUrl = anyharnessBaseUrl();
    // Push a gateway-only agent-auth state: the exact shape a real client
    // (desktop dispatch worker / cloud materialization worker) delivers, with
    // NO native credential anywhere. A synthetic base_url+key is enough — the
    // push is a stored-document write, never validated against a live
    // gateway, and this suite never sends a prompt so no request to it is
    // ever attempted.
    const stateResult = await runtimeFetch(baseUrl, "PUT", "/v1/agent-auth/state", {
      version: 2,
      revision: Date.now(),
      harnesses: [
        {
          harness_kind: HARNESS_KIND,
          sources: [{ kind: "gateway", base_url: "https://gateway.invalid.example", key: "t2-sh-7-fake-key" }],
        },
      ],
    });
    expect(stateResult.status, `agent-auth state push failed: ${JSON.stringify(stateResult.body)}`).toBeLessThan(300);

    const installResult = await runtimeFetch(baseUrl, "POST", `/v1/agents/${HARNESS_KIND}/install`, {});
    expect(installResult.status, `install ${HARNESS_KIND} failed: ${JSON.stringify(installResult.body)}`).toBeLessThan(300);

    const workspaceResult = await runtimeFetch(baseUrl, "POST", "/v1/workspaces", { path: REPO_ROOT });
    expect(workspaceResult.status, `workspace create failed: ${JSON.stringify(workspaceResult.body)}`).toBeLessThan(300);
    workspaceId = (workspaceResult.body as { workspace: { id: string } }).workspace.id;
  });

  test.afterAll(async () => {
    if (!workspaceId) {
      return;
    }
    await runtimeFetch(anyharnessBaseUrl(), "DELETE", `/v1/workspaces/${workspaceId}`).catch(() => undefined);
  });

  test("rejects session creation with a bare native model selector on a gateway-only route", async () => {
    const result = await runtimeFetch(anyharnessBaseUrl(), "POST", "/v1/sessions", {
      workspaceId,
      agentKind: HARNESS_KIND,
      modelId: INELIGIBLE_NATIVE_MODEL_ID,
    });
    // The exact status is an implementation detail (400/422/etc.); what
    // matters is that it is NOT accepted — a native selector reaching LiteLLM
    // would 400 there instead, which is exactly the failure mode this gate
    // exists to prevent before it ever leaves the runtime.
    expect(
      result.status,
      `expected session creation to be REJECTED for native id "${INELIGIBLE_NATIVE_MODEL_ID}" on a ` +
        `gateway-only route, got ${result.status}: ${JSON.stringify(result.body)}`,
    ).toBeGreaterThanOrEqual(400);
  });

  test("accepts session creation with a real gateway-catalog model id", async () => {
    const result = await runtimeFetch(anyharnessBaseUrl(), "POST", "/v1/sessions", {
      workspaceId,
      agentKind: HARNESS_KIND,
      modelId: ELIGIBLE_GATEWAY_MODEL_ID,
    });
    expect(
      result.status,
      `expected session creation to be ACCEPTED for gateway id "${ELIGIBLE_GATEWAY_MODEL_ID}", got ` +
        `${result.status}: ${JSON.stringify(result.body)}`,
    ).toBeLessThan(300);
    const session = result.body as { id?: string; modelId?: string; requestedModelId?: string };
    const resolvedModel = session.modelId ?? session.requestedModelId;
    expect(resolvedModel, "session did not resolve any model id").toBeTruthy();
    // Never a bare native selector, even on the accepted path.
    expect(resolvedModel).not.toBe(INELIGIBLE_NATIVE_MODEL_ID);
    // No session delete endpoint exists (router.rs has none); deleting the
    // workspace in afterAll is sufficient cleanup for this ephemeral runtime-home.
  });
});
