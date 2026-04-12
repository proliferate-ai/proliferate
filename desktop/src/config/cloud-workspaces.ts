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
    description: "Waiting for the backend to start provisioning your sandbox.",
  },
  {
    status: "provisioning",
    label: "Provisioning sandbox",
    description: "Allocating the cloud sandbox and preparing the base environment.",
  },
  {
    status: "syncing_credentials",
    label: "Syncing credentials",
    description: "Making your configured cloud agent credentials available in the sandbox.",
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
    description: "The workspace is ready for sessions, terminals, and file operations.",
  },
];
