import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceScratchPadRecord {
  content: string;
  updatedAtMs: number | null;
}

export interface WorkspaceScratchPadWriteResult {
  updatedAtMs: number | null;
}

export async function readWorkspaceScratchPad(
  workspaceKey: string,
): Promise<WorkspaceScratchPadRecord> {
  return invoke<WorkspaceScratchPadRecord>("read_workspace_scratch_pad", { workspaceKey });
}

export async function writeWorkspaceScratchPad(
  workspaceKey: string,
  content: string,
): Promise<WorkspaceScratchPadWriteResult> {
  return invoke<WorkspaceScratchPadWriteResult>("write_workspace_scratch_pad", {
    workspaceKey,
    content,
  });
}
