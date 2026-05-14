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
} from "../lib/query-keys";

export function useCloudSessionSnapshot(sessionId: string | null, enabled = true) {
  return useQuery<CloudSessionSnapshot>({
    queryKey: cloudSessionSnapshotKey(sessionId),
    queryFn: () => getSessionSnapshot(sessionId!),
    enabled: enabled && sessionId !== null,
  });
}

export function useCloudTranscriptSnapshot(sessionId: string | null, enabled = true) {
  return useQuery<CloudTranscriptSnapshot>({
    queryKey: cloudTranscriptSnapshotKey(sessionId),
    queryFn: () => getTranscriptSnapshot(sessionId!),
    enabled: enabled && sessionId !== null,
  });
}

