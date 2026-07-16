import type { RuntimePressureTargetState } from "#product/hooks/workspaces/facade/use-runtime-pressure-control-state";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

/** Local runtime with a judgeable worktree spread: dirty, clean, and orphan
 * rows with realistic sizes, so the environment card's full anatomy shows. */
export function createPlaygroundEnvironmentTargetState(): RuntimePressureTargetState {
  return {
    target: {
      key: "local:http://127.0.0.1:8457",
      label: "Local runtime",
      location: "local",
      runtimeUrl: "http://127.0.0.1:8457",
      runtimeGeneration: 0,
      environmentId: null,
    },
    inventory: [
      worktreeRow({
        id: "wt-1",
        name: "composer-popover-cleanup",
        branch: "worktree-composer-popover-cleanup",
        state: "dirty",
        sessions: 2,
        worktreeMb: 480,
        logsMb: 22,
      }),
      worktreeRow({
        id: "wt-2",
        name: "transcript-polish",
        branch: "worktree-transcript-polish",
        state: "clean",
        sessions: 1,
        worktreeMb: 410,
        logsMb: 9,
      }),
      worktreeRow({
        id: "wt-3",
        name: null,
        branch: "codex/orphaned-experiment",
        state: "orphan",
        sessions: 0,
        worktreeMb: 260,
        logsMb: 0,
      }),
    ],
    isLoading: false,
    error: null,
    inventoryLoading: false,
    inventoryError: null,
    healthLoading: false,
    healthError: null,
    worktreeCount: 3,
    totalWorktreeCount: 3,
    pressureRepoLabel: "proliferate",
    idealWorktreeCount: 20,
    pressurePercent: 15,
    pressureLimitPercent: 100,
    ringProgressPercent: 15,
    pressureLabel: "3 of 20",
    detailLines: [],
    tone: "success",
    resourcePressure: null,
  } as RuntimePressureTargetState;
}

function worktreeRow({
  id,
  name,
  branch,
  state,
  sessions,
  worktreeMb,
  logsMb,
}: {
  id: string;
  name: string | null;
  branch: string;
  state: "clean" | "dirty" | "orphan";
  sessions: number;
  worktreeMb: number;
  logsMb: number;
}): RuntimePressureTargetState["inventory"][number] {
  return {
    id,
    path: `/Users/dev/.proliferate/worktrees/proliferate/${branch.split("/").pop()}`,
    branch,
    repoRootId: "repo-root-1",
    repoRootName: "proliferate",
    state: state === "orphan" ? "orphan_checkout" : "associated",
    managed: true,
    materialized: true,
    availableActions: state === "orphan"
      ? ["delete_orphan_checkout"]
      : ["delete_workspace_history"],
    blockers: [],
    associatedWorkspaces: name
      ? [
        {
          id: `${id}-ws`,
          displayName: name,
          branch,
          kind: "worktree",
          lifecycleState: "active",
          cleanupState: "none",
          sessionCount: sessions,
        },
      ]
      : [],
    totalSessionCount: sessions,
    gitStatus: {
      state: state === "dirty" ? "dirty" : "clean",
      clean: state !== "dirty",
      conflicted: false,
      changedFileCount: state === "dirty" ? 7 : 0,
      untrackedFileCount: state === "dirty" ? 2 : 0,
      ahead: state === "dirty" ? 1 : 0,
      behind: 0,
      errorMessage: null,
    },
    storage: {
      worktreeBytes: worktreeMb * 1024 * 1024,
      sqliteBytes: logsMb * 1024 * 1024,
      totalBytes: null,
    },
  } as RuntimePressureTargetState["inventory"][number];
}

/** The advanced session config the card absorbs from the old overflow menu:
 * codex permissions (select) + a reasoning toggle, one section each. */
export function createPlaygroundEnvironmentAdvancedControls(): LiveSessionControlDescriptor[] {
  return [
    {
      key: "mode",
      label: "Permissions",
      detail: "Auto",
      rawConfigId: "mode",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        { value: "read-only", label: "Read Only", selected: false },
        { value: "auto", label: "Auto", selected: true },
        { value: "full-access", label: "Full Access", selected: false },
      ],
      onSelect: () => undefined,
    },
    {
      key: "reasoning",
      label: "Reasoning",
      detail: "On",
      rawConfigId: "reasoning",
      settable: true,
      pendingState: null,
      kind: "toggle",
      enabledValue: "on",
      disabledValue: "off",
      isEnabled: true,
      options: [
        { value: "off", label: "Off", selected: false },
        { value: "on", label: "On", selected: true },
      ],
      onSelect: () => undefined,
    },
  ];
}
