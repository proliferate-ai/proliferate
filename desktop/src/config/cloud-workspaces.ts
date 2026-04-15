import type { CloudWorkspaceStatus } from "@/lib/integrations/cloud/client";

export interface CloudWorkspaceStepDefinition {
  status: CloudWorkspaceStatus;
  label: string;
  description: string;
}

export const CLOUD_WORKSPACE_PROVISIONING_STEPS: CloudWorkspaceStepDefinition[] = [
  {
    status: "queued",
    label: "Queued",
    description: "Waiting to prepare the cloud workspace.",
  },
  {
    status: "provisioning",
    label: "Preparing workspace",
    description: "Allocating the cloud runtime and preparing the base environment.",
  },
  {
    status: "syncing_credentials",
    label: "Syncing credentials",
    description: "Making configured agent credentials available in the cloud workspace.",
  },
  {
    status: "cloning_repo",
    label: "Cloning repository",
    description: "Checking out the repository and preparing the cloud branch.",
  },
  {
    status: "starting_runtime",
    label: "Starting runtime",
    description: "Launching AnyHarness and reconciling the cloud agents.",
  },
  {
    status: "ready",
    label: "Ready",
    description: "The workspace is ready for chat, terminals, and file operations.",
  },
];
