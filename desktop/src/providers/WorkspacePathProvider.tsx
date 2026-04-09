import { createContext, useContext, useMemo, type ReactNode } from "react";

interface WorkspacePathContextValue {
  /** Absolute filesystem root of the active workspace, or null if none. */
  workspacePath: string | null;
  /**
   * Resolve a raw path string (relative or absolute) to an absolute path on
   * disk, or `null` if no workspace is active and the input is relative.
   *
   * - Absolute paths (`/…`) are returned unchanged.
   * - `~/…` is left unresolved (callers that need home expansion should do
   *   it themselves; we don't import the Tauri home helper here to keep this
   *   provider sync + workspace-agnostic).
   * - Relative paths are joined to `workspacePath`.
   * - An optional `:line` or `:line:col` suffix is preserved on the result.
   */
  resolveAbsolute: (rawPath: string) => string | null;
}

const WorkspacePathContext = createContext<WorkspacePathContextValue>({
  workspacePath: null,
  resolveAbsolute: () => null,
});

export function WorkspacePathProvider({
  workspacePath,
  children,
}: {
  workspacePath: string | null;
  children: ReactNode;
}) {
  const value = useMemo<WorkspacePathContextValue>(() => {
    return {
      workspacePath,
      resolveAbsolute: (rawPath: string) => {
        const trimmed = rawPath.trim();
        if (trimmed.length === 0) return null;

        // Absolute — return as-is.
        if (trimmed.startsWith("/")) return trimmed;

        // ~ paths — leave for caller / shell layer to expand.
        if (trimmed.startsWith("~/") || trimmed === "~") return null;

        // Relative — needs an active workspace.
        if (!workspacePath) return null;

        // Strip leading "./".
        const cleaned = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
        const root = workspacePath.endsWith("/")
          ? workspacePath.slice(0, -1)
          : workspacePath;
        return `${root}/${cleaned}`;
      },
    };
  }, [workspacePath]);

  return (
    <WorkspacePathContext.Provider value={value}>
      {children}
    </WorkspacePathContext.Provider>
  );
}

export function useWorkspacePath(): WorkspacePathContextValue {
  return useContext(WorkspacePathContext);
}
