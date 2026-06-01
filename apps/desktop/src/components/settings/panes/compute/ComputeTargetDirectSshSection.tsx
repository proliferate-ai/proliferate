import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import type { ComputeTargetKind } from "@/lib/domain/compute/target-types";

export function ComputeTargetDirectSshSection({
  targetKind,
  sshHost,
  sshPort,
  sshUser,
  remoteAnyHarnessPort,
  identityFile,
  workspaceRoot,
  onSshHostChange,
  onSshPortChange,
  onSshUserChange,
  onRemoteAnyHarnessPortChange,
  onIdentityFileChange,
  onWorkspaceRootChange,
}: {
  targetKind: ComputeTargetKind;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  remoteAnyHarnessPort: string;
  identityFile: string;
  workspaceRoot: string;
  onSshHostChange: (value: string) => void;
  onSshPortChange: (value: string) => void;
  onSshUserChange: (value: string) => void;
  onRemoteAnyHarnessPortChange: (value: string) => void;
  onIdentityFileChange: (value: string) => void;
  onWorkspaceRootChange: (value: string) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground">Direct SSH access</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {targetKind === "ssh"
            ? COMPUTE_COPY.directSshHelp
            : COMPUTE_COPY.directSshUnavailable}
        </p>
      </div>
      {targetKind === "ssh" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <div>
              <Label htmlFor="compute-target-detail-ssh-host">Host</Label>
              <Input
                id="compute-target-detail-ssh-host"
                className="font-mono"
                value={sshHost}
                placeholder="44.247.206.119"
                onChange={(event) => onSshHostChange(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="compute-target-detail-ssh-port">Port</Label>
              <Input
                id="compute-target-detail-ssh-port"
                className="font-mono"
                value={sshPort}
                inputMode="numeric"
                onChange={(event) => onSshPortChange(event.target.value)}
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
                onChange={(event) => onSshUserChange(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="compute-target-detail-runtime-port">Runtime port</Label>
              <Input
                id="compute-target-detail-runtime-port"
                className="font-mono"
                value={remoteAnyHarnessPort}
                inputMode="numeric"
                onChange={(event) => onRemoteAnyHarnessPortChange(event.target.value)}
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
              onChange={(event) => onIdentityFileChange(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="compute-target-detail-workspace-root">Workspace root</Label>
            <Input
              id="compute-target-detail-workspace-root"
              className="font-mono"
              value={workspaceRoot}
              placeholder="~/proliferate-workspaces"
              onChange={(event) => onWorkspaceRootChange(event.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border/50 bg-foreground/5 p-3 text-xs text-muted-foreground">
          {COMPUTE_COPY.directSshNotSshTarget}
        </div>
      )}
    </section>
  );
}
