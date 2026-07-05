/**
 * Effective-config derivation — mirrors the runtime executor's fold
 * (`recompute_active_config` + `ensure_session` in executor.rs).
 *
 * Given a workflow definition, computes for each step:
 * - The effective harness and model in scope
 * - Whether this step opens a new session (harness differs from previous)
 * - The scope index (increments on each new session)
 *
 * Pure function, no side effects.
 */

import type { WorkflowDefinition } from "./definition";

export interface StepEffectiveConfig {
  /** The harness in effect for this step. */
  effectiveHarness: string;
  /** The model in effect for this step (from setup or last agent.config that set one). */
  effectiveModel: string;
  /**
   * True when this step opens a new session:
   * - The first agent-touching step (index 0 of the first scope)
   * - Any agent.config whose harness differs from the previous effective harness
   */
  isNewSession: boolean;
  /** Scope index — increments each time a new session opens. */
  scopeIndex: number;
}

/**
 * Derive the per-step effective config for every step in a workflow definition.
 * Mirrors the executor's fold: setup seeds {harness, model}; each agent.config
 * step folds into the active config for all subsequent steps; an agent step
 * reuses the session when harness matches, opens a new session when it differs.
 */
export function deriveEffectiveConfigs(definition: WorkflowDefinition): StepEffectiveConfig[] {
  const { setup } = definition;
  let effectiveHarness = setup.harness;
  let effectiveModel = setup.model;
  let scopeIndex = 0;
  // Track the "previous" harness before the fold for detecting changes.
  // The first scope (from setup) counts as scope 0 — it opens on the first
  // agent-touching step. We track whether we've seen any agent-touching step yet.
  let firstAgentScopeOpened = false;

  const results: StepEffectiveConfig[] = [];

  for (const step of definition.steps) {
    if (step.kind === "agent.config") {
      const prevHarness = effectiveHarness;
      // Fold: only override fields that are present (mirrors apply_config in executor.rs)
      if (step.harness !== undefined) {
        effectiveHarness = step.harness;
      }
      if (step.model !== undefined) {
        effectiveModel = step.model;
      }

      const harnessChanged = effectiveHarness !== prevHarness;
      const isNew = harnessChanged || !firstAgentScopeOpened;

      if (isNew && firstAgentScopeOpened) {
        scopeIndex++;
      }
      if (!firstAgentScopeOpened) {
        firstAgentScopeOpened = true;
      }

      results.push({
        effectiveHarness,
        effectiveModel,
        isNewSession: isNew,
        scopeIndex,
      });
    } else {
      // Non-config steps: they inherit the current effective config.
      // The first agent-touching step (agent.prompt) in the initial scope
      // implicitly opens the first session.
      let isNew = false;
      if (step.kind === "agent.prompt" && !firstAgentScopeOpened) {
        firstAgentScopeOpened = true;
        isNew = true;
      }

      results.push({
        effectiveHarness,
        effectiveModel,
        isNewSession: isNew,
        scopeIndex,
      });
    }
  }

  return results;
}

/**
 * Derive scope groups from effective configs — contiguous steps sharing the
 * same scopeIndex form a group. Returns the start index and label for each.
 */
export interface ScopeGroup {
  /** Index of the first step in this scope group. */
  startIndex: number;
  /** Index of the last step in this scope group (inclusive). */
  endIndex: number;
  scopeIndex: number;
  harness: string;
  model: string;
}

export function deriveScopeGroups(configs: StepEffectiveConfig[]): ScopeGroup[] {
  if (configs.length === 0) return [];

  const groups: ScopeGroup[] = [];
  let currentGroup: ScopeGroup = {
    startIndex: 0,
    endIndex: 0,
    scopeIndex: configs[0]!.scopeIndex,
    harness: configs[0]!.effectiveHarness,
    model: configs[0]!.effectiveModel,
  };

  for (let i = 1; i < configs.length; i++) {
    const cfg = configs[i]!;
    if (cfg.scopeIndex !== currentGroup.scopeIndex) {
      groups.push(currentGroup);
      currentGroup = {
        startIndex: i,
        endIndex: i,
        scopeIndex: cfg.scopeIndex,
        harness: cfg.effectiveHarness,
        model: cfg.effectiveModel,
      };
    } else {
      currentGroup.endIndex = i;
    }
  }
  groups.push(currentGroup);
  return groups;
}
