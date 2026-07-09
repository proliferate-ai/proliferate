import type { ScenarioDefinition } from "./types.js";
import { ScenarioBlockedError, ScenarioExpectedFailError } from "./types.js";

/**
 * T3-UPDATE-1 — harness convergence, both lanes (pre-verification of tier 4).
 * specs/developing/testing/scenarios.md#T3-UPDATE-1
 *
 * Local-lane finding (2026-07-08, filed as
 * https://github.com/proliferate-ai/proliferate/issues/1025): the LOCAL
 * AnyHarness runtime has **no heartbeat-driven catalog convergence path at
 * all**. `proliferate-worker` (the process that calls
 * `POST /v1/cloud/worker/heartbeat`, reads `desiredVersions.catalogVersion`,
 * and pushes `PUT /v1/catalogs/agents` to the runtime — see
 * `anyharness/crates/proliferate-worker/src/catalog_sync.rs`) is a
 * sandbox-only process; confirmed empirically against a running `t3local`
 * profile — no worker process exists locally (`make dev` starts the API
 * server, desktop, and the bare `anyharness serve` runtime, nothing else).
 * Desktop's local runtime instead ships a bundled TS catalog
 * (`apps/desktop/src/lib/domain/agents/bundled-agent-catalog.ts`), so
 * "bump served catalog version -> heartbeat -> reconcile -> reinstalled" is
 * structurally impossible on the local lane today — this is a real gap
 * between the scenario contract ("both lanes") and what's built, not a test
 * bug, so it is marked expected-fail rather than retried.
 *
 * Sandbox lane: real code path exists (the worker does heartbeat there),
 * but reaching a sandbox at all needs `current_product_user` — blocked
 * until fix/product-user-single-org-bypass merges.
 */
export const t3Update1: ScenarioDefinition = {
  id: "T3-UPDATE-1",
  title: "harness convergence, both lanes",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-UPDATE-1",
  lanes: ["local", "sandbox"],
  requiredEnv: [],
  plan: ({ runtimeLane }) => [
    { description: "record current installed harness CLI versions (baseline)" },
    { description: "bump the served catalog version on the target server (edit+redeploy catalogs/agents/catalog.json)" },
    {
      description:
        runtimeLane === "local"
          ? "[expected-fail: local runtime has no heartbeat/worker process — see file-level doc comment]"
          : "trigger a heartbeat from the sandbox worker; assert the worker pushes the catalog and the runtime reconciles + reinstalls the drifted CLI at the new pin",
    },
    { description: "assert installed CLI version now matches the new catalog pin" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.runtimeLane === "local") {
      throw new ScenarioExpectedFailError(
        "T3-UPDATE-1/local: the local AnyHarness runtime has no heartbeat-driven catalog " +
          "convergence path (no worker process runs locally; desktop uses a bundled TS catalog " +
          "instead). Structural gap, not a flaky test — filed as " +
          "https://github.com/proliferate-ai/proliferate/issues/1025.",
      );
    }
    throw new ScenarioBlockedError(
      "T3-UPDATE-1/sandbox: reaching a sandbox to observe convergence needs current_product_user. " +
        "See src/fixtures/product-gate.ts.",
    );
  },
};
