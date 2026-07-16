/**
 * Two distinct notions of "lane" show up in specs/developing/testing/{README,scenarios}.md,
 * spelled the same way in prose but meaning different things. We keep them as
 * separate types so the CLI and the scenario registry never conflate them.
 */

/**
 * Where the target API server lives. This is the CLI's `--lane` flag.
 * - "local": a local full-stack profile (`make run PROFILE=...`) plus a tunnel,
 *   so E2B sandboxes can call back into it.
 * - "staging": the real staging deployment (publicly reachable already).
 * - "cloud": a run-scoped candidate API published over public HTTPS on the
 *   managed-cloud world's EC2 ingress box (`<run>.qualification.proliferate.com`)
 *   — neither the local profile nor the shared staging deployment. Appended
 *   append-only for PR 2 (Prove One Real Managed-Cloud Workspace); see
 *   worlds/managed-cloud/world.ts. Distinct from the "sandbox" RuntimeLane
 *   below, which is where the E2B workspace runs.
 * - "selfhost": the world-backed self-host target. Each `lanes: ["selfhost"]`
 *   scenario provisions its OWN run-scoped EC2 control plane (candidate bytes,
 *   real DNS/TLS), so there is no shared "target server" the way local/staging/
 *   cloud have — the flag exists so the shipped `qualification-selfhost` Make
 *   target can select the selfhost runtime lane WITHOUT dragging selfhost cells
 *   into the ubuntu `--lane local` sweep (`laneAllowed`). PR 7. See
 *   worlds/selfhost/world.ts.
 */
export type TargetLane = "local" | "staging" | "cloud" | "selfhost";

/**
 * Which runtime a scenario drives, per T3-FIXTURE in scenarios.md:
 * - "local": desktop (web-port mode) + local AnyHarness runtime.
 * - "sandbox": cloud workspace on real E2B.
 * - "selfhost": a run-scoped self-hosted control plane on EC2 (candidate bytes,
 *   real DNS/TLS) driven through the real Desktop renderer + a controller-local
 *   candidate AnyHarness. Append-only addition for PR 3 (see "Parallel Tracks -
 *   Extension Contract"); it is a runtime lane, not a `--lane` target — the
 *   self-host world provisions its own box, so scenarios that declare
 *   `lanes: ["selfhost"]` produce `<scenario>/selfhost/...` cells regardless of
 *   the `--lane` (TargetLane) flag.
 */
export type RuntimeLane = "local" | "sandbox" | "selfhost";

export const ALL_RUNTIME_LANES: readonly RuntimeLane[] = ["local", "sandbox", "selfhost"];

export type DesktopMode = "web" | "native";

export function parseTargetLane(value: string): TargetLane {
  if (value === "local" || value === "staging" || value === "cloud" || value === "selfhost") {
    return value;
  }
  throw new Error(`--lane must be "local", "staging", "cloud", or "selfhost", got "${value}"`);
}

export function parseDesktopMode(value: string): DesktopMode {
  if (value === "web" || value === "native") {
    return value;
  }
  throw new Error(`--desktop must be "web" or "native", got "${value}"`);
}
