import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useCoworkEnable } from "@/hooks/cowork/use-cowork-enable";
import { useCoworkStatus } from "@/hooks/cowork/use-cowork-status";

export function CoworkPane() {
  const { status, isLoading } = useCoworkStatus();
  const { enableCowork, isEnabling } = useCoworkEnable();

  if (isLoading && !status) {
    return (
      <section className="space-y-6">
        <SettingsPageHeader
          title="Cowork"
          description="Managed local threads backed by a dedicated repo root."
        />
        <LoadingState message="Loading cowork" subtext="Checking managed repo state..." />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cowork"
        description="Managed local threads backed by a dedicated repo root."
      />

      {!status?.enabled ? (
        <SettingsCard>
          <div className="space-y-3 p-3">
            <p className="text-sm text-muted-foreground">
              Enable cowork to create managed thread workspaces from a dedicated local repo root.
            </p>
            <div>
              <Button
                type="button"
                onClick={() => { void enableCowork(); }}
                loading={isEnabling}
              >
                Enable Cowork
              </Button>
            </div>
          </div>
        </SettingsCard>
      ) : (
        <SettingsCard>
          <SettingsCardRow
            label="Root path"
            description="Managed repo backing all cowork threads"
          >
            <span className="text-sm text-muted-foreground">
              {status.root?.repoRootPath ?? "Unavailable"}
            </span>
          </SettingsCardRow>
          <SettingsCardRow
            label="Default branch"
            description="Initial branch for the managed cowork repo"
          >
            <span className="text-sm text-muted-foreground">
              {status.root?.defaultBranch ?? "main"}
            </span>
          </SettingsCardRow>
          <SettingsCardRow
            label="Threads"
            description="Current managed thread count"
          >
            <span className="text-sm text-muted-foreground">
              {status.threadCount}
            </span>
          </SettingsCardRow>
        </SettingsCard>
      )}
    </section>
  );
}
