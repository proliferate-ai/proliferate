import { create } from "zustand";
import {
  modelSupportRefusalKey,
  type ModelSupportRefusal,
  type ModelSupportRefusalsByKey,
} from "#product/lib/domain/chat/models/model-support-refusals";

interface ModelSupportState {
  refusalsByKey: ModelSupportRefusalsByKey;
  /** Records a refusal the runtime just returned. Idempotent per key. */
  recordRefusal: (refusal: ModelSupportRefusal) => void;
  /**
   * Forgets every refusal recorded against one workspace. Called when the
   * target's launch options change: a refusal is a claim about the AnyHarness
   * that answered, so once the target reports a new option set the old claim
   * has no standing and a model the user updated for must come back enabled.
   */
  clearWorkspace: (workspaceId: string) => void;
  /**
   * Bumped by the toast's "Choose model" action. A nonce rather than a boolean
   * because two refusals in a row must each be able to reopen the picker; a
   * boolean would need a reset and could latch the popover open.
   */
  pickerRequestNonce: number;
  requestPicker: () => void;
}

/**
 * Models a target refused, per workspace.
 *
 * Session-lifetime only, deliberately: this is inferred knowledge, not
 * something the runtime advertises, so persisting it would let one stale
 * refusal grey out a model for good. Losing it on reload costs one repeated
 * refusal; keeping it too long costs a model the user can no longer reach.
 */
export const useModelSupportStore = create<ModelSupportState>((set) => ({
  refusalsByKey: {},
  pickerRequestNonce: 0,

  requestPicker: () => set((state) => ({
    pickerRequestNonce: state.pickerRequestNonce + 1,
  })),

  recordRefusal: (refusal) => set((state) => {
    const key = modelSupportRefusalKey(refusal);
    if (state.refusalsByKey[key]) {
      return state;
    }
    return {
      refusalsByKey: { ...state.refusalsByKey, [key]: refusal },
    };
  }),

  clearWorkspace: (workspaceId) => set((state) => {
    const entries = Object.entries(state.refusalsByKey)
      .filter(([, refusal]) => refusal.workspaceId !== workspaceId);
    if (entries.length === Object.keys(state.refusalsByKey).length) {
      return state;
    }
    return { refusalsByKey: Object.fromEntries(entries) };
  }),
}));
