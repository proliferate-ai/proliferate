import type { Workspace } from "@anyharness/sdk";

export interface MissingCheckoutCopy {
  /** Panel header + sidebar tooltip. */
  title: string;
  /** Panel body, default (non-confirming) state. */
  body: string;
  /** Send-button tooltip and session-creation block reason. */
  sendBlockedReason: string;
  /** Panel body while the inline delete confirmation is showing. */
  deleteConfirmBody: string;
}

// The runtime reports workspace_directory_missing for both worktree and plain
// local checkouts; the words must follow the workspace kind — "worktree" is
// wrong terminology for a deleted local clone.
export function missingCheckoutCopy(kind: Workspace["kind"]): MissingCheckoutCopy {
  const noun = kind === "worktree" ? "Worktree" : "Workspace folder";
  return {
    title: `${noun} no longer exists`,
    body: "The local checkout for this workspace was removed. Your chat history is still available, but agents, files, and terminals can't run here.",
    sendBlockedReason: `${noun} no longer exists. Agents can't run in this workspace.`,
    deleteConfirmBody:
      "Delete this workspace? Its record and chat history are removed permanently. This cannot be undone.",
  };
}
