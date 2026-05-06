import { create } from "zustand";
import type { DefaultLiveSessionControlKey } from "@/lib/domain/preferences/user-preferences";

export type LaunchProjectionControlValues = Partial<Record<DefaultLiveSessionControlKey, string>>;

export interface LaunchProjectionOverride {
  scopeId: string;
  agentKind: string | null;
  modelId: string | null;
  modeId: string | null;
  controlValues: LaunchProjectionControlValues;
  revision: number;
  updatedAt: number;
}

interface LaunchProjectionOverrideState {
  overrides: Record<string, LaunchProjectionOverride>;
  patchOverride: (
    scopeId: string,
    patch: {
      agentKind?: string | null;
      modelId?: string | null;
      modeId?: string | null;
      controlValues?: LaunchProjectionControlValues;
    },
  ) => LaunchProjectionOverride;
  setControlValue: (
    scopeId: string,
    key: DefaultLiveSessionControlKey,
    value: string,
  ) => LaunchProjectionOverride;
  clearScope: (scopeId: string) => void;
}

function nextOverride(
  current: LaunchProjectionOverride | null,
  scopeId: string,
  patch: {
    agentKind?: string | null;
    modelId?: string | null;
    modeId?: string | null;
    controlValues?: LaunchProjectionControlValues;
  },
): LaunchProjectionOverride {
  return {
    scopeId,
    agentKind: patch.agentKind !== undefined ? patch.agentKind : current?.agentKind ?? null,
    modelId: patch.modelId !== undefined ? patch.modelId : current?.modelId ?? null,
    modeId: patch.modeId !== undefined ? patch.modeId : current?.modeId ?? null,
    controlValues: {
      ...(current?.controlValues ?? {}),
      ...(patch.controlValues ?? {}),
    },
    revision: (current?.revision ?? 0) + 1,
    updatedAt: Date.now(),
  };
}

export function pendingWorkspaceProjectionScope(attemptId: string): string {
  return `pending-workspace:${attemptId}`;
}

export function configuredWorkspaceProjectionScope(workspaceKey: string): string {
  return `configured-default:${workspaceKey}`;
}

export const useLaunchProjectionOverrideStore = create<LaunchProjectionOverrideState>((set) => ({
  overrides: {},

  patchOverride: (scopeId, patch) => {
    let result: LaunchProjectionOverride | null = null;
    set((state) => {
      result = nextOverride(state.overrides[scopeId] ?? null, scopeId, patch);
      return {
        overrides: {
          ...state.overrides,
          [scopeId]: result,
        },
      };
    });
    return result!;
  },

  setControlValue: (scopeId, key, value) => {
    let result: LaunchProjectionOverride | null = null;
    set((state) => {
      const current = state.overrides[scopeId] ?? null;
      result = nextOverride(current, scopeId, {
        controlValues: {
          [key]: value,
        },
      });
      return {
        overrides: {
          ...state.overrides,
          [scopeId]: result,
        },
      };
    });
    return result!;
  },

  clearScope: (scopeId) => set((state) => {
    if (!state.overrides[scopeId]) {
      return state;
    }

    const { [scopeId]: _removed, ...overrides } = state.overrides;
    return { overrides };
  }),
}));
