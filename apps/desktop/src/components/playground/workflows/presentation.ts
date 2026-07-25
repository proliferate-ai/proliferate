/**
 * Pure presentation rules for the workflow mock. In the real PR these become
 * product-domain view models; here they encode the truthfulness rules from
 * run-control.md and the PROVISIONAL doc-6 presentation model so every screen
 * derives from one place.
 */

import type {
  MockBlocker,
  MockDefinition,
  MockDelivery,
  MockFreshness,
  MockRun,
  MockStepStatus,
} from "./fixtures";

/**
 * Client mirror of run-eligibility, computed live from the edited definition
 * so the page flips honestly between runnable and blocked while iterating.
 */
export function computeEligibility(definition: MockDefinition): MockBlocker[] {
  const blockers: MockBlocker[] = [];
  if (definition.stages.length !== 1) {
    blockers.push({
      code: "stage_count_not_supported",
      path: "stages",
      message: `Core V1 runs exactly one harness; this definition has ${definition.stages.length}.`,
    });
  }
  definition.stages.forEach((stage, si) => {
    if (stage.steps.length !== 1) {
      blockers.push({
        code: "step_count_not_supported",
        path: `stages[${si}].steps`,
        message: `Core V1 runs exactly one prompt; harness ${si + 1} has ${stage.steps.length} steps.`,
      });
    }
    stage.steps.forEach((step, pi) => {
      if (step.goal) {
        blockers.push({
          code: "goal_not_supported",
          path: `stages[${si}].steps[${pi}].goal`,
          message: "Goals are stored but not runnable in Core V1.",
        });
      }
    });
  });
  return blockers;
}

/** Monochrome dot vocabulary: shape and motion carry state, never color. */
export type MockDotKind = "hollow" | "filled" | "pulsing" | "failed" | "interrupted";

export interface MockHeadline {
  label: string;
  dot: MockDotKind;
  /** Freshness caveat rendered quietly after the label. */
  suffix?: string;
}

const EXECUTION_TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

export function isExecutionTerminal(run: MockRun): boolean {
  return EXECUTION_TERMINAL.has(run.execution);
}

function freshnessSuffix(run: MockRun): string | undefined {
  if (run.freshness === "stale") return `stale · last seen ${run.lastObservedAt}`;
  if (run.freshness === "unreachable") {
    return run.lastObservedAt
      ? `unreachable · last seen ${run.lastObservedAt}`
      : "unreachable · never observed";
  }
  return undefined;
}

/**
 * One scannable label per run row. Detail always shows the four dimensions
 * separately; this only compresses, it never claims more than is proven.
 */
export function runHeadline(run: MockRun): MockHeadline {
  if (run.delivery === "delivery_failed") return { label: "Delivery failed", dot: "failed" };
  if (run.delivery === "delivery_cancelled") return { label: "Delivery cancelled", dot: "filled" };

  if (isExecutionTerminal(run)) {
    switch (run.execution) {
      case "completed":
        return { label: "Completed", dot: "filled" };
      case "failed":
        return { label: "Failed", dot: "failed" };
      case "cancelled":
        return { label: "Cancelled", dot: "filled" };
      default:
        return { label: "Interrupted", dot: "interrupted" };
    }
  }

  if (run.freshness === "target_lost") {
    return {
      label: "Target lost",
      dot: "hollow",
      suffix: run.cancelRequestedAt ? "after cancellation request" : "outcome unknown",
    };
  }

  if (run.cancelRequestedAt) {
    return { label: "Cancellation requested", dot: "pulsing", suffix: freshnessSuffix(run) };
  }

  if (run.execution === "running" || run.execution === "accepted") {
    return {
      label: run.execution === "running" ? "Running" : "Accepted",
      dot: "pulsing",
      suffix: freshnessSuffix(run),
    };
  }

  // No runtime execution yet: the delivery dimension carries the headline.
  const byDelivery: Record<Exclude<MockDelivery, "delivery_failed" | "delivery_cancelled">, MockHeadline> = {
    prepared: { label: "Prepared", dot: "hollow" },
    queued: { label: "Queued", dot: "hollow" },
    delivering: { label: "Delivering", dot: "pulsing" },
    accepted: { label: "Delivered", dot: "hollow" },
  };
  const base = byDelivery[run.delivery as keyof typeof byDelivery];
  return { ...base, suffix: freshnessSuffix(run) };
}

export function stepDot(status: MockStepStatus): MockDotKind {
  switch (status) {
    case "running":
      return "pulsing";
    case "completed":
    case "cancelled":
      return "filled";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "hollow";
  }
}

// --- Dimension rows for run detail ----------------------------------------------

export interface MockDimensionRow {
  label: string;
  value: string;
  detail?: string;
}

const DELIVERY_LABEL: Record<MockDelivery, string> = {
  prepared: "Prepared",
  queued: "Queued",
  delivering: "Delivering",
  accepted: "Accepted",
  delivery_failed: "Delivery failed",
  delivery_cancelled: "Delivery cancelled",
};

const FRESHNESS_LABEL: Record<MockFreshness, string> = {
  pending: "Pending",
  live: "Live",
  stale: "Stale",
  unreachable: "Unreachable",
  target_lost: "Target lost",
};

export function dimensionRows(run: MockRun): MockDimensionRow[] {
  const executionValue =
    run.execution === "none" ? "No runtime observation yet" : capitalize(run.execution);
  const executionDetail =
    run.execution === "failed" && run.failureCode
      ? run.failureCode
      : run.execution === "interrupted" && run.interruptionCode
        ? "Runtime restart interrupted this run; it was not replayed."
        : undefined;

  const freshnessDetail =
    run.freshness === "target_lost"
      ? "Final outcome unknown. This run cannot be retried or cancelled."
      : run.lastObservedAt
        ? `Last observed ${run.lastObservedAt}`
        : "No successful observation yet";

  return [
    {
      label: "Delivery",
      value: DELIVERY_LABEL[run.delivery],
      detail: run.delivery === "prepared" ? "Created, but delivery was never requested." : undefined,
    },
    {
      label: "Desired",
      value: run.desired === "cancelled" ? "Cancelled" : "Active",
      detail: run.cancelRequestedAt
        ? `Cancellation requested ${run.cancelRequestedAt}. Not proof the turn stopped.`
        : undefined,
    },
    { label: "Execution", value: executionValue, detail: executionDetail },
    { label: "Freshness", value: FRESHNESS_LABEL[run.freshness], detail: freshnessDetail },
  ];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// --- Action availability ---------------------------------------------------------

export interface MockRunActions {
  cancel: "available" | "pending" | "hidden";
  startDelivery: boolean;
  openSession: "available" | "unavailable" | "hidden";
}

export function runActions(run: MockRun): MockRunActions {
  const terminal =
    isExecutionTerminal(run)
    || run.delivery === "delivery_failed"
    || run.delivery === "delivery_cancelled";

  const cancel = terminal || run.freshness === "target_lost"
    ? "hidden"
    : run.cancelRequestedAt
      ? "pending"
      : "available";

  const openSession = !run.correlation
    ? "hidden"
    : run.sessionAvailability === "unavailable"
      ? "unavailable"
      : "available";

  return { cancel, startDelivery: run.delivery === "prepared", openSession };
}
