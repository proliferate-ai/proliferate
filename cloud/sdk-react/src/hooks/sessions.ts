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

export function useCloudSessionSnapshot(sessionId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudSessionSnapshot>({
    queryKey: cloudSessionSnapshotKey(sessionId),
    queryFn: () => getSessionSnapshot(sessionId!, client),
    enabled: enabled && sessionId !== null,
  });
}

export function useCloudTranscriptSnapshot(sessionId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudTranscriptSnapshot>({
    queryKey: cloudTranscriptSnapshotKey(sessionId),
    queryFn: () => getTranscriptSnapshot(sessionId!, client),
    enabled: enabled && sessionId !== null,
  });
}
