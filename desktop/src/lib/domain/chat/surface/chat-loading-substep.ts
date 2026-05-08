/**
 * Loading phases for the workspace -> session -> stream -> history -> first-turn
 * pipeline shown by ChatLoadingHero.
 */
export type ChatLoadingSubstep =
  | "bootstrapping-workspace"
  | "opening-session"
  | "connecting-stream"
  | "loading-history"
  | "awaiting-first-turn";

export interface ResolveChatLoadingSubstepInput {
  activeSessionId: string | null;
  selectedWorkspaceId: string | null;
  hasBootstrappedWorkspace: boolean;
  hasSlot: boolean;
  streamConnectionState: string | null;
  transcriptHydrated: boolean;
  isEmpty: boolean;
  isRunning: boolean;
}

export function resolveChatLoadingSubstep(
  input: ResolveChatLoadingSubstepInput,
): ChatLoadingSubstep {
  if (!input.activeSessionId) {
    if (input.selectedWorkspaceId && input.hasBootstrappedWorkspace) {
      // Edge case: bootstrap completed without opening a session (e.g. all
      // sessions dismissed). The empty hero takes over from here.
      return "opening-session";
    }
    return "bootstrapping-workspace";
  }

  if (!input.hasSlot) {
    return "opening-session";
  }

  if (!input.transcriptHydrated) {
    return input.streamConnectionState === "open"
      ? "loading-history"
      : "connecting-stream";
  }

  if (input.isEmpty && input.isRunning) {
    return "awaiting-first-turn";
  }

  // Defensive default for unexpected loading-state drift. The surface hook
  // should normally keep ready/idle states out of ChatLoadingHero.
  return "loading-history";
}
