import { useEffect, useMemo, useRef, useState } from "react";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { AddSshTargetDialog } from "@/components/settings/panes/compute/AddSshTargetDialog";
import { ComputeTargetDetails } from "@/components/settings/panes/compute/ComputeTargetDetails";
import { ComputeTargetList } from "@/components/settings/panes/compute/ComputeTargetList";
import { ChevronRight } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import {
  useCloudTarget,
  useCloudTargets,
} from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useDirectRuntimeAttachStateResolver } from "@/hooks/compute/derived/use-direct-runtime-attach-states";
import { useLoopbackRuntimeDisplayName } from "@/hooks/compute/derived/use-loopback-runtime-name";
import { useComputeTargetAppearancePreferences } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";

const CLOUD_TARGET_KINDS = new Set(["managed_cloud", "self_hosted_cloud"]);

const EMPTY_TARGETS: ComputeTargetSummary[] = [];

interface ComputePaneProps {
  initialTargetId?: string | null;
}

export function ComputePane({ initialTargetId = null }: ComputePaneProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const { data, isLoading } = useCloudTargets(false);
  const targets: ComputeTargetSummary[] = data ?? EMPTY_TARGETS;
  const sshTargets = useMemo(
    () => targets.filter((target) => target.kind === "ssh"),
    [targets],
  );
  const cloudTargets = useMemo(
    () => targets.filter((target) => CLOUD_TARGET_KINDS.has(target.kind)),
    [targets],
  );
  const selectableTargets = useMemo(
    () => [...sshTargets, ...cloudTargets],
    [cloudTargets, sshTargets],
  );
  const loopbackDisplayName = useLoopbackRuntimeDisplayName();
  const getAttachState = useDirectRuntimeAttachStateResolver();
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const consumedInitialTargetIdRef = useRef<string | null>(null);
  const selectedTargetExists = selectedTargetId
    ? selectableTargets.some((target) => target.id === selectedTargetId)
    : false;
  const effectiveTargetId = selectedTargetExists ? selectedTargetId : null;
  const selectedSummary = useMemo(
    () => selectableTargets.find((target) => target.id === effectiveTargetId) ?? null,
    [effectiveTargetId, selectableTargets],
  );
  const { data: selectedDetail, isLoading: detailLoading } = useCloudTarget(
    effectiveTargetId,
    Boolean(effectiveTargetId),
  );
  const { archiveTarget, isArchivingTarget } = useCloudTargetMutations();
  const appearancePreferences = useComputeTargetAppearancePreferences();

  useEffect(() => {
    if (
      initialTargetId
      && consumedInitialTargetIdRef.current !== initialTargetId
      && selectableTargets.some((target) => target.id === initialTargetId)
    ) {
      consumedInitialTargetIdRef.current = initialTargetId;
      setSelectedTargetId(initialTargetId);
    }
  }, [initialTargetId, selectableTargets]);

  useEffect(() => {
    if (
      selectedTargetId
      && !selectableTargets.some((target) => target.id === selectedTargetId)
    ) {
      setSelectedTargetId(null);
    }
  }, [selectedTargetId, selectableTargets]);

  const commonDialog = (
    <AddSshTargetDialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      onTargetAppearanceSaved={appearancePreferences.reload}
    />
  );

  if (effectiveTargetId) {
    return (
      <section className="space-y-6">
        <div className="space-y-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSelectedTargetId(null)}
            className="h-auto px-0 py-0 text-sm hover:bg-transparent"
          >
            {COMPUTE_COPY.title}
            <ChevronRight className="size-4" />
            <span className="text-foreground">
              {selectedSummary?.displayName ?? COMPUTE_COPY.targetFallbackTitle}
            </span>
          </Button>
        </div>

        <ComputeTargetDetails
          target={selectedDetail ?? selectedSummary}
          appearancePreference={appearancePreferences.preferences[effectiveTargetId] ?? null}
          loading={detailLoading}
          onSaveAppearance={appearancePreferences.savePreference}
          archiving={isArchivingTarget}
          onArchive={(targetId) => {
            setArchiveError(null);
            void archiveTarget(targetId).then(() => {
              setSelectedTargetId(null);
            }).catch((error) => {
              setArchiveError(
                error instanceof Error ? error.message : COMPUTE_COPY.archiveError,
              );
            });
          }}
        />

        {archiveError && (
          <p className="text-sm text-destructive">{archiveError}</p>
        )}

        {commonDialog}
      </section>
    );
  }

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

      <ComputeTargetList
        targets={sshTargets}
        cloudTargets={cloudTargets}
        appearancePreferences={appearancePreferences.preferences}
        loading={isLoading || appearancePreferences.loading}
        selectedTargetId={effectiveTargetId}
        loopbackDisplayName={loopbackDisplayName}
        getAttachState={getAttachState}
        onSelectTarget={setSelectedTargetId}
        onAddSshTarget={() => setDialogOpen(true)}
      />

      {archiveError && (
        <p className="text-sm text-destructive">{archiveError}</p>
      )}

      {commonDialog}
    </section>
  );
}
