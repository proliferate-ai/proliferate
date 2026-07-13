import type { ScenarioDefinition, ScenarioRunContext } from "../types.js";
import { ScenarioBlockedError } from "../types.js";
import { currentProductOwnershipViolations } from "../../foundation/worlds/managed-cloud-upgrade/index.js";

/**
 * T4-RUNTIME-1 — heartbeat-driven managed-cloud runtime upgrade, N-1 -> N.
 *
 * This REPLACES the legacy T4-CLOUD-1 (which mutated the global staging
 * RUNTIME_VERSION ECS env pin and asserted direct-Worker convergence — both now
 * forbidden). The real implementation lives in the foundation world under
 * `src/foundation/worlds/managed-cloud-upgrade/`:
 *   - ManagedCloudUpgradeWorldProvisioner (contracts/world.ts handle),
 *   - the retained-production N-1 manifest loader + capture script,
 *   - the run/target-scoped desired-version channel (never a global pin),
 *   - the immutable candidate-N artifact route, and
 *   - `runT4Runtime1`, which drives baseline -> flip -> the intended
 *     Worker-mailbox / Supervisor-activate / AnyHarness-reconcile ownership
 *     assertion and preserves failing evidence at the exact divergence.
 *
 * That world executes through the foundation runner lifecycle (candidate +
 * retained manifests, typed ready-world handle, cleanup ledger, evidence sink),
 * which the legacy `ScenarioDefinition` CLI here does NOT yet supply. Until the
 * CLI is wired to the foundation contracts, this row reports `blocked` with the
 * exact reason — it never fakes a green, and it never falls back to the legacy
 * global-pin mutation.
 *
 * The blocked diagnosis also enumerates the KNOWN product ownership gaps that
 * make the intended path fail today (see `currentProductOwnershipViolations`
 * and the world's unit tests, which reproduce the failing evidence without E2B):
 * these are the owning product changes — Worker mailbox write, Supervisor
 * consume/activate/health-gate, target-scoped desired version, and release
 * version stamping (#1089).
 */
export const t4Runtime1: ScenarioDefinition = {
  id: "T4-RUNTIME-1",
  title: "Managed-cloud sandbox runtime upgrade N-1 -> N via Worker mailbox + Supervisor activation",
  registryFlowRef: "specs/developing/testing/tier-4-scenario-contract.md#T4-RUNTIME-1",
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_E2B_API_KEY", "RELEASE_E2E_E2B_TEAM_ID"],
  plan: () => [
    { description: "resolve the retained production N-1 manifest (immutable E2B template + component digests)" },
    { description: "prepare the managed-cloud-upgrade world (fixed candidate qualification API, run/target desired-version channel, immutable candidate-N route)" },
    { description: "provision the disposable actor's sandbox from the immutable N-1 template via the real GitHub-authorized path" },
    { description: "assert N-1 Supervisor/Worker/AnyHarness/catalog/agent identities; complete one bounded cheap-model baseline turn" },
    { description: "flip ONLY this run/target's desired AnyHarness version N-1 -> exact N (never the global pin)" },
    { description: "assert Worker writes exactly one durable Supervisor mailbox request and does NOT self-activate" },
    { description: "assert Supervisor consumes/verifies/stages/activates/health-gates N; AnyHarness N reconciles native+ACP agents; state preserved; post-update turn" },
  ],
  run: async (ctx: ScenarioRunContext) => {
    if (ctx.dryRun) {
      return;
    }
    if (ctx.targetLane !== "staging" && ctx.runtimeLane !== "sandbox") {
      throw new ScenarioBlockedError(
        "T4-RUNTIME-1 runs in the managed-cloud-upgrade world (real E2B + candidate qualification API). " +
          "Run it on the sandbox lane against a candidate deployment.",
      );
    }
    // The foundation world (provisioner + candidate/retained manifests + typed
    // ready-world handle + cleanup ledger) is not yet wired into this legacy
    // ScenarioDefinition CLI. Report blocked with the precise reason plus the
    // enumerated product ownership gaps — never a fabricated green.
    const violations = currentProductOwnershipViolations("N-1", "N");
    const enumerated = violations.map((v) => `        - [${v.rule}] ${v.detail}`).join("\n");
    throw new ScenarioBlockedError(
      "T4-RUNTIME-1 executes through the foundation managed-cloud-upgrade world " +
        "(src/foundation/worlds/managed-cloud-upgrade): ManagedCloudUpgradeWorldProvisioner + the candidate/" +
        "retained artifact manifests + the typed ready-world handle. The legacy release CLI runner does not " +
        "yet construct those foundation inputs, so this row is blocked on runner<->foundation wiring rather " +
        "than executed. It never mutates the global RUNTIME_VERSION pin (the forbidden legacy T4-CLOUD-1 knob).\n" +
        "    Known product ownership gaps this scenario asserts (owning changes; failing evidence reproduced by " +
        "the world's unit tests without E2B):\n" +
        enumerated,
    );
  },
};
