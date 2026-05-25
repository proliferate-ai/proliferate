import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export function cloudWorkspaceUsesCloudRuntime(
  workspace: Pick<CloudWorkspaceSummary, "directTargetContext" | "sandboxType"> | null | undefined,
): boolean {
  if (!workspace) {
    return false;
  }

  const targetKind = workspace?.directTargetContext?.targetKind ?? null;
  if (targetKind === "desktop_dispatch" || targetKind === "local_direct" || targetKind === "ssh") {
    return false;
  }

  const sandboxType = workspace?.sandboxType ?? "managed_personal";
  return sandboxType !== "local" && sandboxType !== "ssh";
}
