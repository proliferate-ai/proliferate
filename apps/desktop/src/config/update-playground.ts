export type UpdatePreviewPhase =
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdatePreviewState {
  id: string;
  phase: UpdatePreviewPhase;
  version: string | null;
  currentVersion: string;
  progress: number | null;
  checkedAt: string | null;
  title: string;
  description: string;
  detail: string;
  primaryAction: string;
  secondaryAction: string | null;
}

export const UPDATE_PREVIEW_STATES: UpdatePreviewState[] = [
  {
    id: "checking",
    phase: "checking",
    version: null,
    currentVersion: "0.1.22",
    progress: null,
    checkedAt: null,
    title: "Checking for updates",
    description: "Looking for a new version.",
    detail: "Takes a few seconds.",
    primaryAction: "Checking",
    secondaryAction: null,
  },
  {
    id: "available",
    phase: "available",
    version: "0.1.24",
    currentVersion: "0.1.22",
    progress: null,
    checkedAt: "Just now",
    title: "Update available",
    description: "Proliferate 0.1.24 is out.",
    detail: "Download in the background and keep working.",
    primaryAction: "Download",
    secondaryAction: "Later",
  },
  {
    id: "downloading",
    phase: "downloading",
    version: "0.1.24",
    currentVersion: "0.1.22",
    progress: 68,
    checkedAt: "Just now",
    title: "Downloading update",
    description: "Proliferate 0.1.24 is on its way.",
    detail: "Keep working — nothing pauses.",
    primaryAction: "Downloading",
    secondaryAction: null,
  },
  {
    id: "ready",
    phase: "ready",
    version: "0.1.24",
    currentVersion: "0.1.22",
    progress: null,
    checkedAt: "Just now",
    title: "Restart to update",
    description: "Proliferate 0.1.24 is ready.",
    detail: "Restart at a good stopping point.",
    primaryAction: "Restart now",
    secondaryAction: "Later",
  },
  {
    id: "error",
    phase: "error",
    version: null,
    currentVersion: "0.1.22",
    progress: null,
    checkedAt: "12 minutes ago",
    title: "Couldn't check for updates",
    description: "Couldn't reach the update server.",
    detail: "Check your connection and try again.",
    primaryAction: "Try again",
    secondaryAction: null,
  },
];
