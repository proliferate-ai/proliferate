import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";

interface AgentAuthInstallGateProps {
  displayName: string;
  /** Omitted when there is no local agent record to set up (missing/loading). */
  onInstall?: () => void;
  /** True while the local agent record is still being loaded. */
  loading?: boolean;
}

/**
 * Shown in place of the authentication controls when a harness is not
 * installed on this machine, or while its local record is still loading
 * (spec §9): install first, then pick a route. Never renders auth controls
 * for a missing/not-yet-loaded harness.
 */
export function AgentAuthInstallGate({
  displayName,
  onInstall,
  loading = false,
}: AgentAuthInstallGateProps) {
  if (loading) {
    return (
      <SettingsCard>
        <div className="flex flex-col gap-2 p-4">
          <p className="text-sm font-semibold text-foreground">Authentication</p>
          <p className="text-sm text-muted-foreground">
            Checking {displayName} on this machine…
          </p>
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">Authentication</p>
          <p className="text-sm text-muted-foreground">
            {displayName} is not installed on this machine. Install it to
            configure authentication.
          </p>
        </div>
        {onInstall ? (
          <Button type="button" variant="secondary" size="sm" onClick={onInstall}>
            Install
          </Button>
        ) : null}
      </div>
    </SettingsCard>
  );
}
