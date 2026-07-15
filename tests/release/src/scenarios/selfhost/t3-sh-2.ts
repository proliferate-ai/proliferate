import type { ScenarioDefinition } from "../types.js";
import { ScenarioBlockedError } from "../types.js";

/**
 * T3-SH-2 — real (Tauri) desktop against a self-hosted box.
 * specs/developing/testing/self-hosting.md#T3-SH-2 (§4)
 *
 * The only lane that proves the native connect slice end-to-end: a real Tauri
 * desktop build connects to alpha -> password login -> reset -> connects to
 * beta, exercising the `set_app_config` write, the app relaunch, and the OS
 * credential store. Per self-hosting.md §4 this slice is unreachable from
 * desktop-web (the connect affordance is Tauri-gated at
 * apps/desktop/src/components/auth/LoginScreen.tsx:117, and
 * lib/access/tauri/credentials.ts throws outside Tauri), so T2-SH-1 covers the
 * dialog/validation logic and this scenario owns the native slice.
 *
 * Driving it needs a real desktop build plus a headless native driver invoking
 * the connect Tauri commands directly (the analogue of the updater-driver
 * T4-DESKTOP-1 uses). That driver is not built yet, so this scenario reports
 * blocked — never red — everywhere today, keeping the gap visible without a
 * fake pass. It is gated the same way T4-DESKTOP-1 is (macOS aarch64 + explicit
 * opt-in) so that, once the driver lands, flipping it on is a one-line change.
 */
export const t3Sh2: ScenarioDefinition = {
  id: "T3-SH-2",
  title: "real Tauri desktop connect to a self-hosted box (native slice)",
  registryFlowRef: "specs/developing/testing/self-hosting.md#T3-SH-2",
  lanes: ["local"],
  requiredEnv: [],
  plan: () => [
    { description: "launch a real Tauri desktop build (native connect driver)" },
    { description: "connect to alpha; assert the config.json write + relaunch + trust screen" },
    { description: "password login against alpha; credential stored in the OS keychain" },
    { description: "reset, then connect to beta; assert the config switch" },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new ScenarioBlockedError(
        `T3-SH-2: the native connect slice requires a real macOS aarch64 desktop build; this host is ` +
          `${process.platform}/${process.arch}. Blocked, not red.`,
      );
    }
    throw new ScenarioBlockedError(
      "T3-SH-2: the headless native connect driver (real Tauri build invoking set_app_config + relaunch + " +
        "credential-store commands, the analogue of tests/release/upgrade/updater-driver used by " +
        "T4-DESKTOP-1) is not built yet, so the native connect+switch slice cannot be exercised for real. " +
        "Reported blocked so the gap stays visible; T2-SH-1 covers the dialog/validation logic in " +
        "desktop-web. Build the driver, then gate this on RELEASE_E2E_SELFHOST_DESKTOP=1 to run it live.",
    );
  },
};
