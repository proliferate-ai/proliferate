/**
 * Effective-config derivation — format v2 (data-contract §1.1).
 *
 * In v2 a session IS a slot: every agent node opens exactly one session, fixed
 * to that node's `harness` for its whole life (harness never changes mid-slot —
 * a different harness is a different node/slot). Only `model` can change
 * mid-slot, via an `agent.config` step. So for each flattened step:
 * - The effective harness is always the owning node's harness.
 * - The effective model starts at the node's `model` and folds forward through
 *   any `agent.config` steps within that node.
 * - A new session opens exactly at the first step of each agent node.
 *
 * Pure function, no side effects.
 */

import { spineAgentNodes, type WorkflowDefinition } from "./definition";

export interface StepEffectiveConfig {
  /** The harness in effect for this step (fixed per agent node). */
  effectiveHarness: string;
  /** The model in effect for this step (node's model, folded through agent.config). */
  effectiveModel: string;
  /** True for the first step of each agent node — a new session opens there. */
  isNewSession: boolean;
  /** Scope index — one per agent node, in spine order. */
  scopeIndex: number;
}

/**
 * Derive the per-step effective config for every step across the whole spine.
 */
export function deriveEffectiveConfigs(definition: WorkflowDefinition): StepEffectiveConfig[] {
  const results: StepEffectiveConfig[] = [];

  // Flatten parallel groups: every lane is its own agent node / session, so each
  // gets its own scope index (contiguous in the lane-grouped flatten order).
  spineAgentNodes(definition).forEach((node, nodeIndex) => {
    let effectiveModel = node.model;
    node.steps.forEach((step, stepInNode) => {
      if (step.kind === "agent.config") {
        effectiveModel = step.model;
      }
      results.push({
        effectiveHarness: node.harness,
        effectiveModel,
        isNewSession: stepInNode === 0,
        scopeIndex: nodeIndex,
      });
    });
  });

  return results;
}

/**
 * Derive scope groups from effective configs — contiguous steps sharing the
 * same scopeIndex form a group. Returns the start index and label for each.
 */
export interface ScopeGroup {
  /** Index of the first step in this scope group (flattened index). */
  startIndex: number;
  /** Index of the last step in this scope group (inclusive, flattened index). */
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
