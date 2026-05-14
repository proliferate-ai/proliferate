import { useQuery } from "@tanstack/react-query";
import {
  getSessionSnapshot,
  getTranscriptSnapshot,
  type CloudSessionSnapshot,
  type CloudTranscriptSnapshot,
} from "@proliferate/cloud-sdk";
import {
  cloudSessionSnapshotKey,
  cloudTranscriptSnapshotKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useCloudSessionSnapshot(
  targetId: string | null,
  sessionId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  const canQuery =
    enabled &&
    targetId !== null &&
    targetId !== undefined &&
    sessionId !== null &&
    sessionId !== undefined;
  return useQuery<CloudSessionSnapshot>({
    queryKey: cloudSessionSnapshotKey(targetId, sessionId),
    queryFn: () => getSessionSnapshot(sessionId!, { targetId: targetId! }, client),
    enabled: canQuery,
  });
}

export function useCloudTranscriptSnapshot(
  targetId: string | null,
  sessionId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  const canQuery =
    enabled &&
    targetId !== null &&
    targetId !== undefined &&
    sessionId !== null &&
    sessionId !== undefined;
  return useQuery<CloudTranscriptSnapshot>({
    queryKey: cloudTranscriptSnapshotKey(targetId, sessionId),
    queryFn: () => getTranscriptSnapshot(sessionId!, { targetId: targetId! }, client),
    enabled: canQuery,
  });
}
