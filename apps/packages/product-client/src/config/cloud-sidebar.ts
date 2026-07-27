import type { CloudWorkspaceStatus } from "@proliferate/cloud-sdk/types";

export type CloudSidebarStatusTone =
  | "ready"
  | "pending"
  | "error";

export type CloudSidebarStatus = CloudWorkspaceStatus;

export interface CloudSidebarStatusDefinition {
  label: string;
  tone: CloudSidebarStatusTone;
  /**
   * Ink for the label text, in the row's quiet meta tier — no border, no
   * fill, no uppercase tracking. The tone still reads through the dot.
   */
  textClassName: string;
  /** Fill for the small status dot rendered ahead of the label. */
  dotClassName: string;
}

export const CLOUD_SIDEBAR_STATUS_DEFINITIONS = {
  pending: {
    label: "Pending",
    tone: "pending",
    textClassName: "text-sidebar-muted-foreground",
    dotClassName: "bg-warning-border",
  },
  materializing: {
    label: "Preparing",
    tone: "pending",
    textClassName: "text-sidebar-muted-foreground",
    dotClassName: "bg-warning-border",
  },
  needs_rematerialization: {
    label: "Updating",
    tone: "pending",
    textClassName: "text-sidebar-muted-foreground",
    dotClassName: "bg-warning-border",
  },
  ready: {
    label: "Cloud",
    tone: "ready",
    textClassName: "text-sidebar-muted-foreground",
    dotClassName: "bg-sidebar-muted-foreground/60",
  },
  lost: {
    label: "lost",
    tone: "error",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
  archived: {
    label: "Archived",
    tone: "pending",
    textClassName: "text-sidebar-muted-foreground",
    dotClassName: "bg-sidebar-muted-foreground/60",
  },
  error: {
    label: "Error",
    tone: "error",
    textClassName: "text-destructive",
    dotClassName: "bg-destructive",
  },
} as const satisfies Record<CloudWorkspaceStatus, CloudSidebarStatusDefinition>;
