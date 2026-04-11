import type { CoworkThread } from "@anyharness/sdk";
import { useCoworkThreadsQuery } from "@anyharness/sdk-react";

const EMPTY_COWORK_THREADS: CoworkThread[] = [];

export function useCoworkThreads(enabled = true) {
  const query = useCoworkThreadsQuery({ enabled });

  return {
    threads: query.data ?? EMPTY_COWORK_THREADS,
    isLoading: query.isLoading,
  };
}
