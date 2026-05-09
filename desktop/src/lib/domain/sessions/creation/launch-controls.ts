export type LiveDefaultLaunchControlId =
  | "collaboration_mode"
  | "reasoning"
  | "effort"
  | "fast_mode";

export type LiveDefaultLaunchControls = Partial<Record<LiveDefaultLaunchControlId, string>>;

export type LiveDefaultLaunchControlsByAgent = Record<string, LiveDefaultLaunchControls>;

const LIVE_DEFAULT_LAUNCH_CONTROL_IDS = new Set<string>([
  "collaboration_mode",
  "reasoning",
  "effort",
  "fast_mode",
]);

export function pickLiveDefaultLaunchControls(
  values: Record<string, string> | undefined,
): LiveDefaultLaunchControls {
  if (!values) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) =>
      LIVE_DEFAULT_LAUNCH_CONTROL_IDS.has(key) && value.trim().length > 0
    ),
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
