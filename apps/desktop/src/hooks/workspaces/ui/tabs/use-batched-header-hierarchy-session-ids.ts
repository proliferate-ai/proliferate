import { useEffect, useMemo, useState } from "react";

const HEADER_HIERARCHY_INITIAL_QUERY_BATCH_SIZE = 4;
const HEADER_HIERARCHY_QUERY_BATCH_SIZE = 4;
const HEADER_HIERARCHY_QUERY_BATCH_DELAY_MS = 1_200;

export function useBatchedHeaderHierarchySessionIds({
  prioritySessionIds,
  sessionIds,
  workspaceId,
}: {
  prioritySessionIds: string[];
  sessionIds: string[];
  workspaceId: string | null;
}): Set<string> {
  const orderedSessionIds = useMemo(() => {
    const sessionIdSet = new Set(sessionIds);
    const prioritized = prioritySessionIds.filter((sessionId) => sessionIdSet.has(sessionId));
    return [
      ...new Set(prioritized),
      ...sessionIds.filter((sessionId) => !prioritized.includes(sessionId)),
    ];
  }, [prioritySessionIds, sessionIds]);
  const sessionSignature = useMemo(
    () => [workspaceId ?? "", ...orderedSessionIds].join("\u001f"),
    [orderedSessionIds, workspaceId],
  );
  const [enabledCount, setEnabledCount] = useState(() =>
    Math.min(HEADER_HIERARCHY_INITIAL_QUERY_BATCH_SIZE, orderedSessionIds.length)
  );

  useEffect(() => {
    setEnabledCount(Math.min(
      HEADER_HIERARCHY_INITIAL_QUERY_BATCH_SIZE,
      orderedSessionIds.length,
    ));
  }, [orderedSessionIds.length, sessionSignature]);

  useEffect(() => {
    if (enabledCount >= orderedSessionIds.length) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setEnabledCount((current) =>
        Math.min(current + HEADER_HIERARCHY_QUERY_BATCH_SIZE, orderedSessionIds.length)
      );
    }, HEADER_HIERARCHY_QUERY_BATCH_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [enabledCount, orderedSessionIds.length, sessionSignature]);

  return useMemo(
    () => new Set(orderedSessionIds.slice(0, enabledCount)),
    [enabledCount, orderedSessionIds],
  );
}
