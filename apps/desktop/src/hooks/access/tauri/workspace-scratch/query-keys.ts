export function workspaceScratchPadKey(workspaceKey: string | null | undefined) {
  return ["tauri", "workspace-scratch-pad", workspaceKey ?? null] as const;
}
