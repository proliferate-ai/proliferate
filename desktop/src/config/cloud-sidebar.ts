import type { CloudWorkspaceStatus } from "@/lib/integrations/cloud/client";

export type CloudSidebarStatusTone =
  | "ready"
  | "pending"
  | "error"
  | "stopped";

export type CloudSidebarStatus = CloudWorkspaceStatus;

export interface CloudSidebarStatusDefinition {
  label: string;
  tone: CloudSidebarStatusTone;
  className: string;
}

export const CLOUD_SIDEBAR_STATUS_DEFINITIONS = {
  queued: {
    label: "queued",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  provisioning: {
    label: "provisioning",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  syncing_credentials: {
    label: "syncing",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  cloning_repo: {
    label: "cloning",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  starting_runtime: {
    label: "starting",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  ready: {
    label: "cloud",
    tone: "ready",
    className:
      "border-sidebar-border/65 bg-sidebar-accent/30 text-sidebar-muted-foreground/64",
  },
  stopped: {
    label: "stopped",
    tone: "stopped",
    className:
      "border-sidebar-border/65 bg-sidebar/70 text-sidebar-muted-foreground/72",
  },
  error: {
    label: "error",
    tone: "error",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
} as const satisfies Record<CloudWorkspaceStatus, CloudSidebarStatusDefinition>;
