import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/Badge";
import { Archive, Check, RefreshCw, Server } from "@/components/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useSshDirectTargetProfile } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import { useSandboxProfileTargetState } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { useSandboxProfileRuntimeConfig } from "@proliferate/cloud-sdk-react/hooks/runtime-config";
import {
  computeTargetKindLabel,
  computeTargetOwnerLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
} from "@/lib/domain/compute/target-presentation";
import {
  COMPUTE_TARGET_COLOR_OPTIONS,
  COMPUTE_TARGET_ICON_OPTIONS,
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
import { ComputeTargetReadiness } from "./ComputeTargetReadiness";
import { ComputeTargetIconGlyph, ComputeTargetSwatch } from "./ComputeTargetSwatch";

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
      <SettingsCard className="min-h-[320px]">
        <div className="space-y-4 p-4">
          <div className="h-4 w-48 rounded-full bg-foreground/10" />
          <div className="h-24 rounded-md bg-foreground/5" />
          <div className="h-24 rounded-md bg-foreground/5" />
          <p className="text-sm text-muted-foreground">Loading target details...</p>
        </div>
      </SettingsCard>
    );
  }
  if (!target || !draftAppearance) {
    return <ComputeTargetEmptyState />;
  }

  const canTestConnection = target.kind === "ssh"
    && Boolean(sshHost.trim())
    && Boolean(sshUser.trim());

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
    <SettingsCard>
      <div className="border-b border-border/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ComputeTargetSwatch appearance={draftAppearance} size="sm" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium text-foreground">
                {draftAppearance.displayName}
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {computeTargetKindLabel(target.kind)}
                {" · "}
                {computeTargetStatusLabel(target.status).toLowerCase()}
                {" · "}
                {computeTargetOwnerLabel(target.ownerScope)}
                {target.statusDetail?.lastHeartbeatAt
                  ? ` · last heartbeat ${target.statusDetail.lastHeartbeatAt}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={computeTargetStatusTone(target.status)}>
              {computeTargetStatusLabel(target.status)}
            </Badge>
            {target.kind === "ssh" && (
              <Button
                type="button"
                variant="ghost"
                disabled={!canTestConnection}
                loading={directProfile.testing}
                onClick={() => { void handleTestConnection(); }}
              >
                <RefreshCw className="size-3.5" />
                {COMPUTE_COPY.testConnection}
              </Button>
            )}
            <Button type="button" onClick={() => { void handleSave(); }}>
              <Check className="size-3.5" />
              {COMPUTE_COPY.save}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4">
        <section className="space-y-3">
          <div>
            <div className="text-sm font-medium text-foreground">Appearance</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {COMPUTE_COPY.appearanceHelp}
            </p>
          </div>
          <div>
            <Label htmlFor="compute-target-detail-display-name">Name</Label>
            <Input
              id="compute-target-detail-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMPUTE_TARGET_ICON_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  aria-label={option.label}
                  aria-pressed={iconId === option.id}
                  title={option.label}
                  className={`inline-flex size-8 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-foreground ${
                    iconId === option.id
                      ? "border-foreground text-foreground"
                      : "border-transparent bg-surface-control text-muted-foreground"
                  }`}
                  onClick={() => setIconId(option.id)}
                >
                  <ComputeTargetIconGlyph iconId={option.id} />
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMPUTE_TARGET_COLOR_OPTIONS.map((option) => {
                const style = {
                  "--compute-target-color": option.value,
                } as CSSProperties;
                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    aria-label={option.label}
                    aria-pressed={colorId === option.id}
                    title={option.label}
                    className={`relative size-[26px] rounded-md border bg-[var(--compute-target-color)] transition-transform hover:scale-105 ${
                      colorId === option.id
                        ? "ring-1 ring-foreground ring-offset-2 ring-offset-background"
                        : "border-border"
                    }`}
                    style={style}
                    onClick={() => setColorId(option.id)}
                  />
                );
              })}
            </div>
          </div>
        </section>

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

        <section className="space-y-3">
          <div>
            <div className="text-sm font-medium text-foreground">Direct SSH access</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {target.kind === "ssh"
                ? COMPUTE_COPY.directSshHelp
                : COMPUTE_COPY.directSshUnavailable}
            </p>
          </div>
          {target.kind === "ssh" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <div>
                  <Label htmlFor="compute-target-detail-ssh-host">Host</Label>
                  <Input
                    id="compute-target-detail-ssh-host"
                    className="font-mono"
                    value={sshHost}
                    placeholder="44.247.206.119"
                    onChange={(event) => setSshHost(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="compute-target-detail-ssh-port">Port</Label>
                  <Input
                    id="compute-target-detail-ssh-port"
                    className="font-mono"
                    value={sshPort}
                    inputMode="numeric"
                    onChange={(event) => setSshPort(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <div>
                  <Label htmlFor="compute-target-detail-ssh-user">User</Label>
                  <Input
                    id="compute-target-detail-ssh-user"
                    className="font-mono"
                    value={sshUser}
                    placeholder="ubuntu"
                    onChange={(event) => setSshUser(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="compute-target-detail-runtime-port">Runtime port</Label>
                  <Input
                    id="compute-target-detail-runtime-port"
                    className="font-mono"
                    value={remoteAnyHarnessPort}
                    inputMode="numeric"
                    onChange={(event) => setRemoteAnyHarnessPort(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="compute-target-detail-identity-file">SSH key path</Label>
                <Input
                  id="compute-target-detail-identity-file"
                  className="font-mono"
                  value={identityFile}
                  placeholder="~/.ssh/id_ed25519"
                  onChange={(event) => setIdentityFile(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="compute-target-detail-workspace-root">Workspace root</Label>
                <Input
                  id="compute-target-detail-workspace-root"
                  className="font-mono"
                  value={workspaceRoot}
                  placeholder="~/proliferate-workspaces"
                  onChange={(event) => setWorkspaceRoot(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 bg-foreground/5 p-3 text-xs text-muted-foreground">
              {COMPUTE_COPY.directSshNotSshTarget}
            </div>
          )}
        </section>

        {feedback && <p className="text-xs text-muted-foreground">{feedback}</p>}

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
    </SettingsCard>
  );
}

function ComputeTargetEmptyState() {
  return (
    <SettingsCard className="min-h-[320px]">
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="inline-flex size-11 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
          <Server className="size-5" aria-hidden="true" />
        </span>
        <div className="max-w-sm space-y-2">
          <h3 className="text-sm font-medium text-foreground">{COMPUTE_COPY.selectTargetTitle}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {COMPUTE_COPY.selectTargetDescription}
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}

function validPortOrDefault(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

function Divider() {
  return <div className="-mx-4 h-px bg-border/40" />;
}
