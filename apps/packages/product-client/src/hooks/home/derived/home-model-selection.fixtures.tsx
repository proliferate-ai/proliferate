import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Launch-options wire fixtures and the query host shared by the Home model
 *  selection tests. Extracted so the suite stays under the line cap without
 *  trimming the rationale on the assertions themselves. */

export const LOCAL_TARGET = {
  kind: "local",
  sourceRoot: "/repo",
  existingWorkspaceId: null,
} as const;

export const CLOUD_TARGET = {
  kind: "cloud",
  gitOwner: "owner",
  gitRepoName: "repo",
  baseBranch: "main",
} as const;

export function response() {
  return {
    harnessKind: "claude",
    basisRevision: "basis-1",
    revision: 2,
    state: "observed",
    probePhase: "idle",
    options: {
      models: [
        { id: "fable", observedName: "Fable", observedDescription: null },
        { id: "unknown-upstream", observedName: null, observedDescription: null },
      ],
      controls: [],
      defaults: { modelId: "fable", controlValues: {} },
    },
    observedAt: "2026-08-19T00:00:00Z",
    probeAttemptedAt: "2026-08-19T00:00:00Z",
    probeFailureCode: null,
    readiness: "ready",
  };
}

export function codexResponse() {
  return {
    ...response(),
    harnessKind: "codex",
    options: {
      models: [{ id: "gpt-5.6-sol", observedName: "GPT-5.6 Sol", observedDescription: null }],
      controls: [],
      defaults: { modelId: "gpt-5.6-sol", controlValues: {} },
    },
  };
}

export function entry(
  harnessKind: string,
  data: Record<string, unknown> | null,
  flags?: { isPending?: boolean; isError?: boolean },
) {
  return {
    harnessKind,
    data,
    isPending: flags?.isPending ?? false,
    isError: flags?.isError ?? false,
  };
}

/** Mutations must not retry: a refused probe has to stay refused so the
 *  all-refused tally is reached. */
export function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
