import type { DesktopLaunchModelRegistry } from "#product/lib/domain/agents/cloud-launch-catalog-types";

export interface WorkflowBuilderModelOption {
  id: string;
  label: string;
}

export interface WorkflowBuilderHarnessOption {
  agentKind: string;
  label: string;
  models: WorkflowBuilderModelOption[];
}

/**
 * The harness/model vocabulary a gen-2 node's optional `model` picks from.
 *
 * Sourced from the cloud agent catalog's launch-model registries — the same
 * projection the composer's model picker reads — because that projection is
 * what `useCloudAgentCatalog` actually returns. Gen-1's authoring helpers
 * (`workflowModelOptions` in `domain/workflows/definition.ts`) read
 * `agent.session.models`, a shape the projection does not carry; reusing them
 * here would reproduce that mismatch rather than the model catalog.
 *
 * Harnesses with no models are dropped: a harness row that offers nothing to
 * pick is a dead option, and the node's `model` stays optional anyway.
 */
export function workflowBuilderHarnessOptions(
  registries: readonly DesktopLaunchModelRegistry[] | null | undefined,
): WorkflowBuilderHarnessOption[] {
  return (registries ?? [])
    .filter((registry) => registry.models.length > 0)
    .map((registry) => ({
      agentKind: registry.kind,
      label: registry.displayName || registry.kind,
      models: registry.models.map((model) => ({
        id: model.id,
        label: model.displayName || model.id,
      })),
    }));
}

/** The models a chosen harness offers; `[]` for an unknown or unset harness. */
export function workflowBuilderModelOptions(
  harnesses: readonly WorkflowBuilderHarnessOption[],
  agentKind: string | null | undefined,
): WorkflowBuilderModelOption[] {
  if (!agentKind) {
    return [];
  }
  return harnesses.find((harness) => harness.agentKind === agentKind)?.models ?? [];
}
