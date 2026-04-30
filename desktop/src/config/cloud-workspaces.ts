import type { CloudWorkspaceStatus } from "@/lib/integrations/cloud/client";

export interface CloudWorkspaceStepDefinition {
  status: CloudWorkspaceStatus;
  label: string;
  description: string;
}

export const CLOUD_WORKSPACE_PROVISIONING_STEPS: CloudWorkspaceStepDefinition[] = [
  {
    status: "pending",
    label: "Queued",
    description: "Waiting to prepare the cloud workspace.",
  },
  {
    status: "materializing",
    label: "Preparing runtime",
    description: "Preparing the repo runtime and materializing the cloud worktree.",
  },
  {
    status: "ready",
    label: "Ready",
    description: "The workspace is ready for chat, terminals, and file operations.",
  },
];
