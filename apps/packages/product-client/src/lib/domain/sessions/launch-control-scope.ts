/**
 * One target-observed control statement scoped to an exact model id.
 *
 * The runtime keeps the harness-level statement for compatibility and adds
 * these scopes when it could observe a model's live option set. An empty
 * scoped `controls` array is authoritative; it must not fall back to the
 * harness-level controls.
 */
export interface ObservedModelLaunchControlScope<TControl> {
  modelId: string;
  controls: readonly TControl[];
  defaultControlValues: Readonly<Record<string, string>>;
}

export interface ObservedLaunchControlOptions<TControl> {
  controls: readonly TControl[];
  defaults: {
    modelId?: string | null;
    controlValues: Readonly<Record<string, string>>;
  };
  modelControls?: readonly ObservedModelLaunchControlScope<TControl>[] | null;
}

export interface ResolvedObservedLaunchControlScope<TControl> {
  controls: readonly TControl[];
  defaultControlValues: Readonly<Record<string, string>>;
  source: "model" | "harness";
}

/**
 * Resolve the exact selected-model statement when the target observed one.
 * Older targets do not send `modelControls`; those retain the shipped flat
 * harness statement until they are upgraded.
 */
export function resolveObservedLaunchControlScope<TControl>(
  options: ObservedLaunchControlOptions<TControl>,
  modelId: string | null | undefined,
): ResolvedObservedLaunchControlScope<TControl> {
  const effectiveModelId = modelId || options.defaults.modelId || null;
  const modelScope = effectiveModelId
    ? options.modelControls?.find((candidate) => candidate.modelId === effectiveModelId)
    : undefined;
  if (modelScope) {
    return {
      controls: modelScope.controls,
      defaultControlValues: modelScope.defaultControlValues,
      source: "model",
    };
  }
  return {
    controls: options.controls,
    defaultControlValues: options.defaults.controlValues,
    source: "harness",
  };
}
