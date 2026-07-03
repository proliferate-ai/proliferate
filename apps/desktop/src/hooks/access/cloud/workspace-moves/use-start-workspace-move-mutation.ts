import "@/lib/access/cloud/client";

export { useStartWorkspaceMove } from "@proliferate/cloud-sdk-react/hooks/workspace-moves";
// Typed 409 code thrown by `useStartWorkspaceMove` on collision (spec section 2,
// "Collision"). Re-exported here so callers only need this access module, not the raw
// cloud SDK, to build the open-vs-replace decision.
export { WORKSPACE_MOVE_CLOUD_WORKSPACE_EXISTS_ERROR_CODE } from "@proliferate/cloud-sdk";
