import type { MovePhase } from "@/lib/domain/workspaces/move/move-model";

export type MoveProgressStepStatus = "done" | "active" | "pending";

export interface MoveProgressStep {
  key: "prepare" | "transfer" | "switch_over" | "clean_up";
  label: string;
  status: MoveProgressStepStatus;
}

const STEP_ORDER: MoveProgressStep["key"][] = ["prepare", "transfer", "switch_over", "clean_up"];
const STEP_LABELS: Record<MoveProgressStep["key"], string> = {
  prepare: "Prepare",
  transfer: "Transfer sessions",
  switch_over: "Switch over",
  clean_up: "Clean up",
};

/**
 * Maps the saga's server-confirmed phase (plus the client-only "running" state fired
 * before the first phase change lands) onto the four-step progress modal from the
 * locked UI decision (spec section 2.6): Prepare -> Transfer sessions -> Switch over ->
 * Clean up. `resume.phase` from a resumed move maps the same way, since resuming just
 * re-enters this same phase sequence.
 */
export function resolveMoveProgressSteps(phase: MovePhase | "running"): MoveProgressStep[] {
  const activeIndex = activeStepIndex(phase);
  return STEP_ORDER.map((key, index) => ({
    key,
    label: STEP_LABELS[key],
    status: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
  }));
}

function activeStepIndex(phase: MovePhase | "running"): number {
  switch (phase) {
    case "running":
    case "started":
    case "failed":
      return 0;
    case "destination_ready":
      return 1;
    case "installed":
      return 2;
    case "cutover":
      return 3;
    case "completed":
      // One past the last step -- every step renders "done".
      return STEP_ORDER.length;
  }
}
