import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";

interface AgentAuthLocalSourcesOptions {
  listSyncableAgentAuthCredentials: () => Promise<LocalAgentAuthSource[]>;
  setFeedback: (feedback: string | null) => void;
}

export function useAgentAuthLocalSources({
  listSyncableAgentAuthCredentials,
  setFeedback,
}: AgentAuthLocalSourcesOptions) {
  const [localSourceError, setLocalSourceError] = useState<string | null>(null);
  const [localSources, setLocalSources] = useState<LocalAgentAuthSource[]>([]);
  const [rescanning, setRescanning] = useState(false);
  const localSourcesByProvider = useMemo(
    () => new Map(localSources.map((source) => [source.provider, source])),
    [localSources],
  );

  useEffect(() => {
    let cancelled = false;
    void loadLocalSources(listSyncableAgentAuthCredentials, setRescanning)
      .then((sources) => {
        if (!cancelled) {
          setLocalSources(sources);
          setLocalSourceError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalSources([]);
          setLocalSourceError(
            error instanceof Error ? error.message : "Could not scan local credentials.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listSyncableAgentAuthCredentials]);

  const handleRescan = useCallback(async () => {
    setFeedback(null);
    setLocalSourceError(null);
    try {
      const sources = await loadLocalSources(listSyncableAgentAuthCredentials, setRescanning);
      setLocalSources(sources);
      setFeedback("Local credentials scanned.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not scan local credentials.";
      setLocalSourceError(message);
      setFeedback(message);
    }
  }, [listSyncableAgentAuthCredentials, setFeedback]);

  return {
    localSourceError,
    localSourcesByProvider: localSourcesByProvider as Map<AgentAuthProvider, LocalAgentAuthSource>,
    rescanning,
    handleRescan,
  };
}

async function loadLocalSources(
  listSyncableAgentAuthCredentials: () => Promise<LocalAgentAuthSource[]>,
  setRescanning: (rescanning: boolean) => void,
) {
  setRescanning(true);
  try {
    return await listSyncableAgentAuthCredentials();
  } finally {
    setRescanning(false);
  }
}
