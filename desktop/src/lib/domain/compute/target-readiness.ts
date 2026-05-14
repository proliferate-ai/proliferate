import type { ComputeTargetInventory } from "@/lib/domain/compute/target-types";

export interface ComputeReadinessItem {
  key: "git" | "node" | "python";
  label: string;
  ready: boolean;
  detail: string;
}

function hasAvailableFlag(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) {
    return false;
  }
  if (typeof value.available === "boolean") {
    return value.available;
  }
  return Object.values(value).some((entry) => (
    typeof entry === "object"
    && entry !== null
    && "available" in entry
    && (entry as { available?: unknown }).available === true
  ));
}

export function computeTargetReadiness(
  inventory: ComputeTargetInventory | null | undefined,
): ComputeReadinessItem[] {
  return [
    {
      key: "git",
      label: "Git",
      ready: hasAvailableFlag(inventory?.git),
      detail: "Required for repository checkout and worktree operations.",
    },
    {
      key: "node",
      label: "Node / npm",
      ready: hasAvailableFlag(inventory?.node),
      detail: "Required for most product MCP servers and plugin materialization.",
    },
    {
      key: "python",
      label: "Python / uv",
      ready: hasAvailableFlag(inventory?.python),
      detail: "Used by Python-based setup scripts and some future MCP bundles.",
    },
  ];
}
