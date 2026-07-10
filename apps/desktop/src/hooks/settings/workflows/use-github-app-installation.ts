import { useEffect, useRef, useState } from "react";
import { useStartGitHubAppInstallation } from "@proliferate/cloud-sdk-react";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

// Same staggered refetch cadence the user-authorization flow uses: the GitHub
// return may land on another settings surface, so poll the caller's authority
// query for a while in case the user comes back to this view directly.
const INSTALLATION_REFRESH_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 40_000, 80_000];

// GitHub's per-user installation settings page — where repository access for an
// existing installation is managed. The same target the Account and
// Organization panes open for "Manage repository access".
const INSTALLATION_SETTINGS_URL = "https://github.com/settings/installations";

export interface GitHubAppInstallationFlow {
  /** Start installation for the active org, then open GitHub. */
  install: () => void;
  /** Open the installation settings page to grant repository access. */
  openInstallationSettings: () => void;
  installing: boolean;
  error: string | null;
}

/**
 * Starts the GitHub App installation flow — the same
 * `useStartGitHubAppInstallation` mutation + external-browser handoff the
 * Organization settings GitHub App section drives — and, for the repo-access
 * gap, opens the installation settings page. Both schedule a few refetches of
 * the caller's authority query so a returning user self-heals out of the gate.
 */
export function useGitHubAppInstallation({
  organizationId,
  returnTo,
  onInstallationReturn,
}: {
  organizationId: string | null;
  returnTo: string;
  onInstallationReturn?: () => void;
}): GitHubAppInstallationFlow {
  const start = useStartGitHubAppInstallation();
  const { openExternal } = useTauriShellActions();
  const [error, setError] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const onReturnRef = useRef(onInstallationReturn);
  onReturnRef.current = onInstallationReturn;

  useEffect(() => () => {
    for (const timerId of timersRef.current) {
      window.clearTimeout(timerId);
    }
  }, []);

  function scheduleReturnRefresh() {
    for (const timerId of timersRef.current) {
      window.clearTimeout(timerId);
    }
    timersRef.current = INSTALLATION_REFRESH_DELAYS_MS.map((delayMs) =>
      window.setTimeout(() => onReturnRef.current?.(), delayMs),
    );
  }

  function install() {
    if (!organizationId) {
      return;
    }
    setError(null);
    void (async () => {
      try {
        const response = await start.mutateAsync({
          organizationId,
          options: { returnTo },
        });
        await openExternal(response.installationUrl);
        scheduleReturnRefresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "GitHub App installation failed.");
      }
    })();
  }

  function openInstallationSettings() {
    setError(null);
    void (async () => {
      try {
        await openExternal(INSTALLATION_SETTINGS_URL);
        scheduleReturnRefresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not open GitHub settings.");
      }
    })();
  }

  return { install, openInstallationSettings, installing: start.isPending, error };
}
