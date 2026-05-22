import type {
  ComputeTargetKind,
  ComputeTargetStatus,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

export interface ComputeTargetOwnerGroup {
  id: "personal" | "organization";
  label: string;
  description: string;
  targets: ComputeTargetSummary[];
}

export function computeTargetKindLabel(kind: ComputeTargetKind): string {
  switch (kind) {
    case "managed_cloud":
      return "Managed cloud";
    case "ssh":
      return "SSH target";
    case "desktop_dispatch":
      return "Desktop dispatch";
    case "local_direct":
      return "Local direct";
    case "self_hosted_cloud":
      return "Self-hosted cloud";
  }
}

export function computeTargetStatusTone(
  status: ComputeTargetStatus,
): "success" | "warning" | "neutral" | "destructive" {
  switch (status) {
    case "online":
      return "success";
    case "enrolling":
      return "warning";
    case "offline":
    case "archived":
      return "neutral";
    case "degraded":
      return "destructive";
  }
}

export function computeTargetStatusLabel(status: ComputeTargetStatus): string {
  switch (status) {
    case "online":
      return "Online";
    case "enrolling":
      return "Waiting for enrollment";
    case "offline":
      return "Offline";
    case "degraded":
      return "Degraded";
    case "archived":
      return "Archived";
  }
}

export function computeTargetOwnerLabel(ownerScope: "personal" | "organization"): string {
  return ownerScope === "organization" ? "Organization" : "Personal";
}

export function groupComputeTargetsByOwnerScope(
  targets: readonly ComputeTargetSummary[],
): ComputeTargetOwnerGroup[] {
  const personal = targets.filter((target) => target.ownerScope === "personal");
  const organization = targets.filter((target) => target.ownerScope === "organization");
  const groups: ComputeTargetOwnerGroup[] = [];

  if (personal.length > 0) {
    groups.push({
      id: "personal",
      label: "Personal targets",
      description: "Available to your personal cloud and local work.",
      targets: personal,
    });
  }

  if (organization.length > 0) {
    groups.push({
      id: "organization",
      label: "Organization targets",
      description: "Available to shared cloud work for your organization.",
      targets: organization,
    });
  }

  return groups;
}
