export type LiveDefaultLaunchControls = Record<string, string>;

export type LiveDefaultLaunchControlsByAgent = Record<string, LiveDefaultLaunchControls>;

export function pickLiveDefaultLaunchControls(
  values: Record<string, string> | undefined,
): LiveDefaultLaunchControls {
  if (!values) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).filter(([controlId, value]) => (
      controlId.length > 0 && value.length > 0
    )),
  );
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
