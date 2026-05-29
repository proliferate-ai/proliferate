export interface GroupedChatTab {
  sessionId: string;
  parentSessionId: string | null;
  groupRootSessionId: string;
  isChild: boolean;
}

export function buildGroupedChatTabs(args: {
  visibleSessionIds: string[];
  childToParent: Map<string, string>;
}): GroupedChatTab[] {
  return args.visibleSessionIds.map((sessionId) => {
    const parentSessionId = args.childToParent.get(sessionId) ?? null;
    return {
      sessionId,
      parentSessionId,
      groupRootSessionId: parentSessionId ?? sessionId,
      isChild: !!parentSessionId,
    };
  });
}
