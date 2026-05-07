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
  ready: {
    label: "cloud",
    tone: "ready",
    className:
      "border-sidebar-border/65 bg-sidebar-accent/30 text-sidebar-muted-foreground/64",
  },
  archived: {
    label: "archived",
    tone: "pending",
    className:
      "border-sidebar-border/65 bg-sidebar/70 text-sidebar-muted-foreground/72",
  },
  error: {
    label: "error",
    tone: "error",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
} as const satisfies Record<CloudWorkspaceStatus, CloudSidebarStatusDefinition>;
