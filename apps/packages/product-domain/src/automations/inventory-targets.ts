import type {
  AutomationTargetAvailability,
  AutomationTargetMode,
} from "./inventory";

export const AUTOMATION_DESKTOP_REQUIRED_MESSAGE = "Check this out on the desktop.";

export function automationTargetAvailability(
  targetMode?: AutomationTargetMode | null,
  executionTarget?: string | null,
  targetKind?: string | null,
): AutomationTargetAvailability {
  if (executionTarget === "local" || targetMode === "local") {
    return "desktop_required";
  }
  if (executionTarget === "ssh") {
    return "desktop_required";
  }
  if (targetKind && !isManagedCloudTargetKind(targetKind)) {
    return "desktop_required";
  }
  if (targetMode === "personal_cloud" || targetMode === "shared_cloud") {
    return "managed_cloud";
  }
  if (executionTarget === "cloud") {
    return "managed_cloud";
  }
  return "desktop_required";
}

export function automationTargetLabel(
  targetMode?: AutomationTargetMode | null,
  executionTarget?: string | null,
  targetKind?: string | null,
): string {
  if (executionTarget === "ssh" || targetKind === "ssh") {
    return "SSH target";
  }
  if (targetMode === "local" || executionTarget === "local") {
    return "Local";
  }
  if (targetMode === "shared_cloud") {
    return "Organization cloud";
  }
  if (targetMode === "personal_cloud") {
    return "Personal cloud";
  }
  return "Cloud";
}

function isManagedCloudTargetKind(targetKind: string): boolean {
  return targetKind === "managed_cloud"
    || targetKind === "cloud"
    || targetKind === "cowork";
}
