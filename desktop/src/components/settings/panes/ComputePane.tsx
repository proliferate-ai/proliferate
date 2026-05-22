import { useMemo, useState } from "react";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { AddSshTargetDialog } from "@/components/settings/panes/compute/AddSshTargetDialog";
import { ComputeTargetDetails } from "@/components/settings/panes/compute/ComputeTargetDetails";
import { ComputeTargetList } from "@/components/settings/panes/compute/ComputeTargetList";
import { Button } from "@proliferate/ui/primitives/Button";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import {
  useCloudTarget,
  useCloudTargets,
} from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useComputeTargetAppearancePreferences } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";

const EMPTY_TARGETS: ComputeTargetSummary[] = [];

export function ComputePane() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const { data, isLoading } = useCloudTargets();
  const targets: ComputeTargetSummary[] = data ?? EMPTY_TARGETS;
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const effectiveTargetId = selectedTargetId ?? targets[0]?.id ?? null;
  const selectedSummary = useMemo(
    () => targets.find((target) => target.id === effectiveTargetId) ?? null,
    [effectiveTargetId, targets],
  );
  const { data: selectedDetail, isLoading: detailLoading } = useCloudTarget(
    effectiveTargetId,
    Boolean(effectiveTargetId),
  );
  const { archiveTarget, isArchivingTarget } = useCloudTargetMutations();
  const appearancePreferences = useComputeTargetAppearancePreferences();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title={COMPUTE_COPY.title}
        description={COMPUTE_COPY.description}
        action={(
          <Button type="button" variant="secondary" onClick={() => setDialogOpen(true)}>
            {COMPUTE_COPY.addSshTarget}
          </Button>
        )}
      />

      <div className="space-y-5">
        <ComputeTargetList
          targets={targets}
          appearancePreferences={appearancePreferences.preferences}
          loading={isLoading || appearancePreferences.loading}
          selectedTargetId={effectiveTargetId}
          onSelectTarget={setSelectedTargetId}
          onAddSshTarget={() => setDialogOpen(true)}
        />
        <ComputeTargetDetails
          target={selectedDetail ?? selectedSummary}
          appearancePreference={effectiveTargetId
            ? appearancePreferences.preferences[effectiveTargetId] ?? null
            : null}
          loading={detailLoading && Boolean(effectiveTargetId)}
          onSaveAppearance={appearancePreferences.savePreference}
          archiving={isArchivingTarget}
          onArchive={(targetId) => {
            setArchiveError(null);
            void archiveTarget(targetId).catch((error) => {
              setArchiveError(
                error instanceof Error ? error.message : COMPUTE_COPY.archiveError,
              );
            });
          }}
        />
      </div>

      {archiveError && (
        <p className="text-sm text-destructive">{archiveError}</p>
      )}

      <AddSshTargetDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onTargetAppearanceSaved={appearancePreferences.reload}
      />
    </section>
  );
}
