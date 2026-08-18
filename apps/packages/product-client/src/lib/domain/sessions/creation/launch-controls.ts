export type LiveDefaultLaunchControlId =
  | "collaboration_mode"
  | "reasoning"
  | "effort"
  | "fast_mode";

export type LiveDefaultLaunchControls = Partial<Record<LiveDefaultLaunchControlId, string>>;

export type LiveDefaultLaunchControlsByAgent = Record<string, LiveDefaultLaunchControls>;

// Launch-control values arrive keyed by RAW config id (what the harness calls
// the option), which can differ from the canonical live-default id. Claude
// calls fast mode `fast`, while Codex calls effort `reasoning_effort`.
const LIVE_DEFAULT_LAUNCH_CONTROL_ID_BY_RAW_ID: Record<string, LiveDefaultLaunchControlId> = {
  collaboration_mode: "collaboration_mode",
  reasoning: "reasoning",
  reasoning_effort: "effort",
  effort: "effort",
  fast_mode: "fast_mode",
  fast: "fast_mode",
};

export function pickLiveDefaultLaunchControls(
  values: Record<string, string> | undefined,
): LiveDefaultLaunchControls {
  if (!values) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).flatMap(([rawId, value]) => {
      const id = LIVE_DEFAULT_LAUNCH_CONTROL_ID_BY_RAW_ID[rawId];
      return id && value.trim().length > 0 ? [[id, value]] : [];
    }),
  ) as LiveDefaultLaunchControls;
}

export function mergeLiveDefaultLaunchControls({
  defaults,
  agentKind,
  values,
}: {
  defaults: LiveDefaultLaunchControlsByAgent;
  agentKind: string;
  values: Record<string, string>;
}): LiveDefaultLaunchControlsByAgent {
  const liveControls = pickLiveDefaultLaunchControls(values);
  if (Object.keys(liveControls).length === 0) {
    return defaults;
  }

  return {
    ...defaults,
    [agentKind]: {
      ...(defaults[agentKind] ?? {}),
      ...liveControls,
    },
  };
}
