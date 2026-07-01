import { useEffect, useMemo, useState } from "react";
import { Archive } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useComputeTargetEnrollment } from "@/hooks/settings/workflows/use-compute-target-enrollment";
import { useSshDirectTargetProfile } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import { useSandboxProfileTargetState } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { useSandboxProfileRuntimeConfig } from "@proliferate/cloud-sdk-react/hooks/runtime-config";
import {
  resolveComputeTargetAppearance,
  type ComputeTargetAppearancePreference,
  type ComputeTargetColorId,
  type ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";
import { ComputeTargetAgentAuthCard } from "./ComputeTargetAgentAuthCard";
import { EnrollmentCommandBlock } from "./EnrollmentCommandBlock";
import { ComputeTargetReadiness } from "./ComputeTargetReadiness";
import { ComputeTargetDetailsHeader } from "@/components/settings/panes/compute/ComputeTargetDetailsHeader";
import { ComputeTargetAppearanceSection } from "@/components/settings/panes/compute/ComputeTargetAppearanceSection";
import { ComputeTargetDirectSshSection } from "@/components/settings/panes/compute/ComputeTargetDirectSshSection";
import { ComputeTargetEmptyState } from "@/components/settings/panes/compute/ComputeTargetEmptyState";

interface ComputeTargetDetailsProps {
  target: ComputeTargetDetail | ComputeTargetSummary | null;
  appearancePreference: ComputeTargetAppearancePreference | null;
  loading: boolean;
  onSaveAppearance: (preference: ComputeTargetAppearancePreference) => Promise<void>;
  onArchive: (targetId: string) => void;
  archiving: boolean;
}

export function ComputeTargetDetails({
  target,
  appearancePreference,
  loading,
  onSaveAppearance,
  onArchive,
  archiving,
}: ComputeTargetDetailsProps) {
  const directProfile = useSshDirectTargetProfile(
    target?.kind === "ssh" ? target.id : null,
  );
  const reconnect = useComputeTargetEnrollment();
  const targetOrgAdmin = useIsAdmin(target?.organizationId ?? null);
  const readinessSandboxProfileId = target?.sandboxProfileId ?? null;
  const shouldLoadSandboxReadiness = target?.kind === "managed_cloud"
    && readinessSandboxProfileId !== null;
  const targetStateQuery = useSandboxProfileTargetState(
    readinessSandboxProfileId,
    shouldLoadSandboxReadiness,
  );
  const runtimeConfigQuery = useSandboxProfileRuntimeConfig(
    readinessSandboxProfileId,
    shouldLoadSandboxReadiness,
  );
  const [displayName, setDisplayName] = useState("");
  const [iconId, setIconId] = useState<ComputeTargetIconId>("monitor");
  const [colorId, setColorId] = useState<ComputeTargetColorId>("blue");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [remoteAnyHarnessPort, setRemoteAnyHarnessPort] = useState("8457");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const targetAppearance = useMemo(() => {
    if (!target) {
      return null;
    }
    return resolveComputeTargetAppearance({
      targetId: target.id,
      displayName: target.displayName,
      kind: target.kind,
      preference: appearancePreference,
    });
  }, [appearancePreference, target]);

  const draftAppearance = useMemo(() => {
    if (!target) {
      return null;
    }
    return resolveComputeTargetAppearance({
      targetId: target.id,
      displayName: target.displayName,
      kind: target.kind,
      preference: {
        targetId: target.id,
        displayName: displayName.trim() || null,
        iconId,
        colorId,
      },
    });
  }, [colorId, displayName, iconId, target]);

  useEffect(() => {
    if (!target || !targetAppearance) {
      setDisplayName("");
      setIconId("monitor");
      setColorId("blue");
      setFeedback(null);
      return;
    }
    setDisplayName(targetAppearance.displayName);
    setIconId(targetAppearance.iconId);
    setColorId(targetAppearance.colorId);
    setFeedback(null);
  }, [target, targetAppearance]);

  useEffect(() => {
    const profile = directProfile.profile;
    setSshHost(profile?.sshHost ?? "");
    setSshUser(profile?.sshUser ?? "");
    setSshPort(String(profile?.sshPort ?? 22));
    setIdentityFile(profile?.identityFile ?? "");
    setRemoteAnyHarnessPort(String(profile?.remoteAnyHarnessPort ?? 8457));
    setWorkspaceRoot(profile?.workspaceRoot ?? target?.defaultWorkspaceRoot ?? "");
  }, [directProfile.profile, target?.defaultWorkspaceRoot, target?.id]);

  if (loading) {
    return (
      <div className="min-h-[320px] space-y-4">
        <div className="h-4 w-48 rounded-full bg-foreground/10" />
        <div className="h-24 rounded-md bg-foreground/5" />
        <div className="h-24 rounded-md bg-foreground/5" />
        <p className="text-sm text-muted-foreground">Loading target details...</p>
      </div>
    );
  }
  if (!target || !draftAppearance) {
    return <ComputeTargetEmptyState />;
  }

  const canTestConnection = target.kind === "ssh"
    && Boolean(sshHost.trim())
    && Boolean(sshUser.trim());
  const canReconnect = canTestConnection
    && (target.ownerScope !== "organization" || targetOrgAdmin.isAdmin);

  async function handleSave() {
    if (!target) {
      return;
    }
    setFeedback(null);
    const trimmedName = displayName.trim();
    try {
      await onSaveAppearance({
        targetId: target.id,
        displayName: trimmedName && trimmedName !== target.displayName ? trimmedName : null,
        iconId,
        colorId,
      });
      if (target.kind === "ssh" && (sshHost.trim() || sshUser.trim())) {
        await directProfile.saveProfile(buildSshProfileInput(target.id));
      }
      setFeedback(COMPUTE_COPY.saveSuccess);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : COMPUTE_COPY.saveError);
    }
  }

  async function handleTestConnection() {
    if (!target || target.kind !== "ssh") {
      return;
    }
    setFeedback(null);
    try {
      const result = await directProfile.testConnection(buildSshProfileInput(target.id));
      setFeedback(`${COMPUTE_COPY.testConnectionSuccess} ${result.localUrl}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : COMPUTE_COPY.testConnectionError);
    }
  }

  async function handleReconnect() {
    if (!target || target.kind !== "ssh") {
      return;
    }
    setFeedback(null);
    try {
      const profileInput = buildSshProfileInput(target.id);
      const result = await reconnect.reconnectSshTarget({
        targetId: target.id,
        displayName: displayName.trim() || target.displayName,
        ownerScope: target.ownerScope,
        organizationId: target.organizationId ?? null,
        defaultWorkspaceRoot: workspaceRoot.trim() || target.defaultWorkspaceRoot || null,
        directAccess: profileInput,
        appearance: {
          iconId,
          colorId,
        },
      });
      setFeedback(
        result.localUrl
          ? `${COMPUTE_COPY.connectSuccess} ${result.localUrl}.`
          : COMPUTE_COPY.connectSuccessNoTunnel,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : COMPUTE_COPY.testConnectionError);
    }
  }

  function buildSshProfileInput(targetId: string) {
    const parsedSshPort = Number.parseInt(sshPort, 10);
    const parsedRuntimePort = Number.parseInt(remoteAnyHarnessPort, 10);
    return {
      targetId,
      sshHost,
      sshUser,
      sshPort: validPortOrDefault(parsedSshPort, 22),
      identityFile: identityFile.trim() || null,
      remoteAnyHarnessPort: validPortOrDefault(parsedRuntimePort, 8457),
      workspaceRoot: workspaceRoot.trim() || target?.defaultWorkspaceRoot || null,
    };
  }

  return (
    <div>
      <ComputeTargetDetailsHeader
        target={target}
        appearance={draftAppearance}
        canReconnect={canReconnect}
        canTestConnection={canTestConnection}
        reconnecting={reconnect.isCreating}
        testing={directProfile.testing}
        reconnectTitle={
          target.ownerScope === "organization" && !targetOrgAdmin.isAdmin
            ? "Only organization admins can reconnect shared SSH targets."
            : undefined
        }
        onReconnect={() => { void handleReconnect(); }}
        onTestConnection={() => { void handleTestConnection(); }}
        onSave={() => { void handleSave(); }}
      />

      <div className="space-y-5 p-4">
        <ComputeTargetAppearanceSection
          displayName={displayName}
          iconId={iconId}
          colorId={colorId}
          onDisplayNameChange={setDisplayName}
          onIconChange={setIconId}
          onColorChange={setColorId}
        />

        <Divider />

        <ComputeTargetReadiness
          target={target}
          sandboxProfileTargetState={targetStateQuery.data ?? null}
          runtimeConfigStatus={runtimeConfigQuery.data ?? null}
          loadingTargetState={targetStateQuery.isLoading}
          loadingRuntimeConfig={runtimeConfigQuery.isLoading}
        />

        <Divider />

        <ComputeTargetAgentAuthCard target={target} />

        <Divider />

        <ComputeTargetDirectSshSection
          targetKind={target.kind}
          sshHost={sshHost}
          sshPort={sshPort}
          sshUser={sshUser}
          remoteAnyHarnessPort={remoteAnyHarnessPort}
          identityFile={identityFile}
          workspaceRoot={workspaceRoot}
          onSshHostChange={setSshHost}
          onSshPortChange={setSshPort}
          onSshUserChange={setSshUser}
          onRemoteAnyHarnessPortChange={setRemoteAnyHarnessPort}
          onIdentityFileChange={setIdentityFile}
          onWorkspaceRootChange={setWorkspaceRoot}
        />

        {reconnect.phaseState && (
          <div className="rounded-md border border-border/60 bg-foreground/5 p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{reconnect.phaseState.label}</span>
          </div>
        )}

        {feedback && <p className="text-sm text-muted-foreground">{feedback}</p>}

        {reconnect.phaseState?.phase === "failed" && reconnect.enrollment && !reconnect.isCreating && (
          <EnrollmentCommandBlock command={reconnect.enrollment.installCommand} />
        )}

        {target.status !== "archived" && (
          <>
            <Divider />
            <div className="flex justify-start">
              <Button
                type="button"
                variant="ghost"
                loading={archiving}
                onClick={() => {
                  if (window.confirm(COMPUTE_COPY.archiveConfirm)) {
                    onArchive(target.id);
                  }
                }}
              >
                <Archive className="size-3.5" />
                {COMPUTE_COPY.archiveTarget}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function validPortOrDefault(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

function Divider() {
  return <div className="-mx-4 h-px bg-border" />;
}
