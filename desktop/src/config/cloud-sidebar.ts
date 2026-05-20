import type { CloudWorkspaceStatus } from "@/lib/access/cloud/client";

export type CloudSidebarStatusTone =
  | "ready"
  | "pending"
  | "error";

export type CloudSidebarStatus = CloudWorkspaceStatus;

export interface CloudSidebarStatusDefinition {
  label: string;
  tone: CloudSidebarStatusTone;
  className: string;
}

export const CLOUD_SIDEBAR_STATUS_DEFINITIONS = {
  pending: {
    label: "pending",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  materializing: {
    label: "preparing",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  needs_rematerialization: {
    label: "updating",
    tone: "pending",
    className: "border-warning-border bg-warning text-warning-foreground",
  },
  ready: {
    label: "cloud",
    tone: "ready",
    className:
      "border-sidebar-border bg-sidebar-accent text-sidebar-muted-foreground",
  },
  archived: {
    label: "archived",
    tone: "pending",
    className:
      "border-sidebar-border bg-transparent text-sidebar-muted-foreground",
  },
  error: {
    label: "error",
    tone: "error",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
} as const satisfies Record<CloudWorkspaceStatus, CloudSidebarStatusDefinition>;
