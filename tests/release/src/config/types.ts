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
 */
export type TargetLane = "local" | "staging";

/**
 * Which runtime a scenario drives, per T3-FIXTURE in scenarios.md:
 * - "local": desktop (web-port mode) + local AnyHarness runtime.
 * - "sandbox": cloud workspace on real E2B.
 */
export type RuntimeLane = "local" | "sandbox";

export const ALL_RUNTIME_LANES: readonly RuntimeLane[] = ["local", "sandbox"];

export type DesktopMode = "web" | "native";

export function parseTargetLane(value: string): TargetLane {
  if (value === "local" || value === "staging") {
    return value;
  }
  throw new Error(`--lane must be "local" or "staging", got "${value}"`);
}

export function parseDesktopMode(value: string): DesktopMode {
  if (value === "web" || value === "native") {
    return value;
  }
  throw new Error(`--desktop must be "web" or "native", got "${value}"`);
}
