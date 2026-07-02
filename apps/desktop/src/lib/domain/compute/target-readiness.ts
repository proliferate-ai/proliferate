import type {
  ComputeTargetInventory,
  ComputeRuntimeConfigStatus,
  ComputeTargetStatus,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

export interface ComputeReadinessItem {
  key: "target" | "worker" | "git" | "node" | "python" | "runtime-config";
  label: string;
  status: "ready" | "pending" | "missing" | "unavailable";
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
  targetOrInventory: ComputeTargetSummary | ComputeTargetInventory | null | undefined,
  options: {
    runtimeConfigStatus?: ComputeRuntimeConfigStatus | null;
    loadingRuntimeConfig?: boolean;
  } = {},
): ComputeReadinessItem[] {
  const target = isComputeTargetSummary(targetOrInventory) ? targetOrInventory : null;
  const inventory: ComputeTargetInventory | null | undefined = target
    ? target.inventory
    : targetOrInventory as ComputeTargetInventory | null | undefined;
  const targetStatus = target?.status ?? null;
  const currentVersions = target?.update?.currentVersions ?? null;
  const runtimeConfig = options.runtimeConfigStatus ?? null;
  return [
    {
      key: "target",
      label: "Target",
      status: readinessStatusFromTargetStatus(targetStatus),
      detail: target?.statusDetail?.lastHeartbeatAt
        ? `Last heartbeat ${target.statusDetail.lastHeartbeatAt}.`
        : "Worker heartbeat determines whether Cloud can dispatch commands here.",
    },
    {
      key: "worker",
      label: "Worker / AnyHarness",
      status: currentVersions?.workerVersion || currentVersions?.anyharnessVersion
        ? "ready"
        : "unavailable",
      detail: formatWorkerVersions(currentVersions),
    },
    {
      key: "git",
      label: "Git",
      status: hasAvailableFlag(inventory?.git) ? "ready" : "missing",
      detail: "Required for repository checkout and worktree operations.",
    },
    {
      key: "node",
      label: "Node / npm",
      status: hasAvailableFlag(inventory?.node) ? "ready" : "missing",
      detail: "Required for most product MCP servers and plugin materialization.",
    },
    {
      key: "python",
      label: "Python / uv",
      status: hasAvailableFlag(inventory?.python) ? "ready" : "missing",
      detail: "Used by Python-based setup scripts and some future MCP bundles.",
    },
    {
      key: "runtime-config",
      label: "Runtime config",
      status: runtimeConfigReadiness(target, runtimeConfig, options.loadingRuntimeConfig ?? false),
      detail: runtimeConfigDetail(target, runtimeConfig, options.loadingRuntimeConfig ?? false),
    },
  ];
}

function isComputeTargetSummary(
  value: ComputeTargetSummary | ComputeTargetInventory | null | undefined,
): value is ComputeTargetSummary {
  return Boolean(value && "kind" in value && "status" in value);
}

function readinessStatusFromTargetStatus(
  status: ComputeTargetStatus | null,
): ComputeReadinessItem["status"] {
  if (status === "online") {
    return "ready";
  }
  if (status === "enrolling") {
    return "pending";
  }
  if (status === "offline" || status === "degraded") {
    return "missing";
  }
  return "unavailable";
}

function formatWorkerVersions(
  versions: NonNullable<NonNullable<ComputeTargetSummary["update"]>["currentVersions"]> | null,
): string {
  if (!versions) {
    return "Worker version has not been reported by this target.";
  }
  const parts = [
    versions.workerVersion ? `Worker ${versions.workerVersion}` : null,
    versions.anyharnessVersion ? `AnyHarness ${versions.anyharnessVersion}` : null,
    versions.supervisorVersion ? `Supervisor ${versions.supervisorVersion}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Worker version has not been reported.";
}

function runtimeConfigReadiness(
  target: ComputeTargetSummary | null,
  runtimeConfig: ComputeRuntimeConfigStatus | null,
  loading: boolean,
): ComputeReadinessItem["status"] {
  if (!target?.sandboxProfileId) {
    return "unavailable";
  }
  if (loading) {
    return "pending";
  }
  return runtimeConfig?.currentRevision ? "ready" : "missing";
}

function runtimeConfigDetail(
  target: ComputeTargetSummary | null,
  runtimeConfig: ComputeRuntimeConfigStatus | null,
  loading: boolean,
): string {
  if (!target?.sandboxProfileId) {
    return "This target does not have a sandbox profile runtime config.";
  }
  if (loading) {
    return "Loading current sandbox runtime config revision.";
  }
  const revision = runtimeConfig?.currentRevision;
  if (!revision) {
    return "No runtime config revision has been generated for this sandbox profile.";
  }
  return `Revision ${revision.sequence} generated ${revision.createdAt}.`;
}
