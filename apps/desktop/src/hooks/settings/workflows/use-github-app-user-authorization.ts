import { useEffect, useRef, useState } from "react";
import { useStartGitHubAppUserAuthorization } from "@proliferate/cloud-sdk-react";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

// Same staggered refetch cadence the Account pane uses after opening the
// GitHub authorization page: the callback deep-link may land on another
// settings surface, so poll the caller's query for a while in case the user
// returns to this view directly.
const AUTHORIZATION_REFRESH_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 40_000, 80_000];

export interface GitHubAppUserAuthorizationFlow {
  authorize: () => void;
  authorizing: boolean;
  error: string | null;
}

/**
 * Starts the GitHub App user-authorization flow — the same
 * `useStartGitHubAppUserAuthorization` mutation + external-browser handoff the
 * Account settings GitHub App section drives — and schedules a few refetches of
 * the caller's authority query so a returning user self-heals out of the gate.
 */
export function useGitHubAppUserAuthorization({
  returnTo,
  onAuthorizationReturn,
}: {
  returnTo: string;
  onAuthorizationReturn?: () => void;
}): GitHubAppUserAuthorizationFlow {
  const start = useStartGitHubAppUserAuthorization();
  const { openExternal } = useTauriShellActions();
  const [error, setError] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const onReturnRef = useRef(onAuthorizationReturn);
  onReturnRef.current = onAuthorizationReturn;

  useEffect(() => () => {
    for (const timerId of timersRef.current) {
      window.clearTimeout(timerId);
    }
  }, []);

  function authorize() {
    setError(null);
    void (async () => {
      try {
        const response = await start.mutateAsync({ returnTo });
        await openExternal(response.authorizationUrl);
        for (const timerId of timersRef.current) {
          window.clearTimeout(timerId);
        }
        timersRef.current = AUTHORIZATION_REFRESH_DELAYS_MS.map((delayMs) =>
          window.setTimeout(() => onReturnRef.current?.(), delayMs),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "GitHub App authorization failed.");
      }
    })();
  }

  return { authorize, authorizing: start.isPending, error };
}
