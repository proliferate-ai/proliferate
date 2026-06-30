import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export function cloudWorkspaceUsesCloudRuntime(
  workspace: Pick<
    CloudWorkspaceSummary,
    "directTargetContext" | "executionTarget" | "sandboxType"
  > | null | undefined,
): boolean {
  if (!workspace) {
    return false;
  }

  if (
    workspace.executionTarget?.kind === "local_desktop"
    || workspace.executionTarget?.kind === "ssh"
    || workspace.executionTarget?.kind === "self_hosted"
  ) {
    return false;
  }

  const targetKind = workspace?.directTargetContext?.targetKind ?? null;
  if (
    targetKind === "desktop_dispatch"
    || targetKind === "local_direct"
    || targetKind === "ssh"
    || targetKind === "self_hosted_cloud"
  ) {
    return false;
  }

  const sandboxType = workspace?.sandboxType ?? "managed_personal";
  return sandboxType !== "local" && sandboxType !== "ssh" && sandboxType !== "self_hosted";
}

export function cloudWorkspaceUsesManagedSandboxGateway(
  workspace: Pick<
    CloudWorkspaceSummary,
    "directTargetContext" | "executionTarget" | "sandboxType"
  > | null | undefined,
): boolean {
  if (!workspace || !cloudWorkspaceUsesCloudRuntime(workspace)) {
    return false;
  }
  const sandboxType = workspace.sandboxType ?? "managed_personal";
  return sandboxType === "managed_personal"
    || sandboxType === "managed_shared"
    || workspace.executionTarget?.kind === "managed_cloud";
}
