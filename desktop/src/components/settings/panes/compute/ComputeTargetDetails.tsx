import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { useSshDirectTargetProfile } from "@/hooks/settings/workflows/use-ssh-direct-target-profile";
import {
  computeTargetKindLabel,
  computeTargetStatusLabel,
  computeTargetStatusTone,
} from "@/lib/domain/compute/target-presentation";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";
import { ComputeTargetReadiness } from "./ComputeTargetReadiness";

interface ComputeTargetDetailsProps {
  target: ComputeTargetDetail | ComputeTargetSummary | null;
  loading: boolean;
  onArchive: (targetId: string) => void;
  archiving: boolean;
}

export function ComputeTargetDetails({
  target,
  loading,
  onArchive,
  archiving,
}: ComputeTargetDetailsProps) {
  const directProfile = useSshDirectTargetProfile(
    target?.kind === "ssh" ? target.id : null,
  );
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [remoteAnyHarnessPort, setRemoteAnyHarnessPort] = useState("8457");
  const [directAccessMessage, setDirectAccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const profile = directProfile.profile;
    setSshHost(profile?.sshHost ?? "");
    setSshUser(profile?.sshUser ?? "");
    setSshPort(String(profile?.sshPort ?? 22));
    setIdentityFile(profile?.identityFile ?? "");
    setRemoteAnyHarnessPort(String(profile?.remoteAnyHarnessPort ?? 8457));
    setDirectAccessMessage(null);
  }, [directProfile.profile, target?.id]);

  if (loading) {
    return (
      <SettingsCard>
        <div className="p-3 text-sm text-muted-foreground">Loading target details...</div>
      </SettingsCard>
    );
  }
  if (!target) {
    return (
      <SettingsCard>
        <div className="p-3 text-sm text-muted-foreground">
          Select a compute target to view its worker, inventory, and readiness.
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <div className="space-y-4 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-foreground">{target.displayName}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {computeTargetKindLabel(target.kind)}
              {target.inventory?.os ? ` · ${target.inventory.os}/${target.inventory.arch ?? "unknown"}` : ""}
            </p>
          </div>
          <Badge tone={computeTargetStatusTone(target.status)}>
            {computeTargetStatusLabel(target.status)}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Workspace root</dt>
            <dd className="mt-1 truncate text-foreground">{target.defaultWorkspaceRoot ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last heartbeat</dt>
            <dd className="mt-1 truncate text-foreground">
              {target.statusDetail?.lastHeartbeatAt ?? "Not seen yet"}
            </dd>
          </div>
        </dl>

        <ComputeTargetReadiness inventory={target.inventory} />

        {target.kind === "ssh" && (
          <div className="space-y-3 border-t border-border/40 pt-3">
            <div>
              <h4 className="text-xs font-medium text-foreground">Direct SSH access</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Used by Desktop to tunnel into the target AnyHarness runtime when opening SSH
                automation workspaces.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
              <div>
                <Label htmlFor="compute-target-detail-ssh-host">SSH host</Label>
                <Input
                  id="compute-target-detail-ssh-host"
                  value={sshHost}
                  placeholder="44.247.206.119"
                  onChange={(event) => setSshHost(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="compute-target-detail-ssh-port">Port</Label>
                <Input
                  id="compute-target-detail-ssh-port"
                  value={sshPort}
                  inputMode="numeric"
                  onChange={(event) => setSshPort(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div>
                <Label htmlFor="compute-target-detail-ssh-user">SSH user</Label>
                <Input
                  id="compute-target-detail-ssh-user"
                  value={sshUser}
                  placeholder="ubuntu"
                  onChange={(event) => setSshUser(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="compute-target-detail-runtime-port">Runtime port</Label>
                <Input
                  id="compute-target-detail-runtime-port"
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
                value={identityFile}
                placeholder="~/.ssh/id_ed25519"
                onChange={(event) => setIdentityFile(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-xs text-muted-foreground">
                {directAccessMessage ?? (
                  directProfile.profile ? "Direct access configured." : "Direct access not configured."
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={directProfile.loading}
                disabled={!sshHost.trim() || !sshUser.trim()}
                onClick={() => {
                  const parsedSshPort = Number.parseInt(sshPort, 10);
                  const parsedRuntimePort = Number.parseInt(remoteAnyHarnessPort, 10);
                  void directProfile.saveProfile({
                    targetId: target.id,
                    sshHost,
                    sshUser,
                    sshPort: Number.isFinite(parsedSshPort) ? parsedSshPort : 22,
                    identityFile: identityFile.trim() || null,
                    remoteAnyHarnessPort: Number.isFinite(parsedRuntimePort)
                      ? parsedRuntimePort
                      : 8457,
                  }).then(() => {
                    setDirectAccessMessage("Direct access saved.");
                  }).catch((error) => {
                    setDirectAccessMessage(
                      error instanceof Error ? error.message : "Failed to save direct access.",
                    );
                  });
                }}
              >
                Save direct access
              </Button>
            </div>
          </div>
        )}

        {target.status !== "archived" && (
          <div className="flex justify-end border-t border-border/40 pt-3">
            <Button
              type="button"
              variant="outline"
              loading={archiving}
              onClick={() => {
                if (window.confirm(COMPUTE_COPY.archiveConfirm)) {
                  onArchive(target.id);
                }
              }}
            >
              Archive target
            </Button>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
