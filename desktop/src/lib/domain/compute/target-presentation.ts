import type { ComputeTargetKind, ComputeTargetStatus } from "@/lib/domain/compute/target-types";

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
