import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { useComputeTargetEnrollment } from "@/hooks/settings/workflows/use-compute-target-enrollment";
import { EnrollmentCommandBlock } from "./EnrollmentCommandBlock";

interface AddSshTargetDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddSshTargetDialog({ open, onClose }: AddSshTargetDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("~/proliferate-workspaces");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [remoteAnyHarnessPort, setRemoteAnyHarnessPort] = useState("8457");
  const [error, setError] = useState<string | null>(null);
  const {
    enrollment,
    isCreating,
    clearEnrollment,
    startSshEnrollment,
  } = useComputeTargetEnrollment();

  const close = () => {
    clearEnrollment();
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsedSshPort = Number.parseInt(sshPort, 10);
    const parsedRuntimePort = Number.parseInt(remoteAnyHarnessPort, 10);
    void startSshEnrollment({
      displayName,
      defaultWorkspaceRoot: workspaceRoot,
      directAccess: {
        sshHost,
        sshUser,
        sshPort: Number.isFinite(parsedSshPort) ? parsedSshPort : 22,
        identityFile: identityFile.trim() || null,
        remoteAnyHarnessPort: Number.isFinite(parsedRuntimePort) ? parsedRuntimePort : 8457,
      },
    }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Could not create enrollment.");
    });
  };

  return (
    <ModalShell
      open={open}
      onClose={close}
      title="Add SSH target"
      description="Create a one-time enrollment command for a machine you can SSH into."
      sizeClassName="max-w-2xl"
      footer={(
        <Button type="button" variant="outline" onClick={close}>
          Done
        </Button>
      )}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <Label htmlFor="compute-target-name">Display name</Label>
          <Input
            id="compute-target-name"
            value={displayName}
            placeholder="Staging SSH Box"
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
            required
          />
        </div>
        <div>
          <Label htmlFor="compute-target-ssh-host">SSH host</Label>
          <Input
            id="compute-target-ssh-host"
            value={sshHost}
            placeholder="44.247.206.119"
            onChange={(event) => setSshHost(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
            required
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <div>
            <Label htmlFor="compute-target-ssh-user">SSH user</Label>
            <Input
              id="compute-target-ssh-user"
              value={sshUser}
              placeholder="ubuntu"
              onChange={(event) => setSshUser(event.target.value)}
              disabled={isCreating || Boolean(enrollment)}
              required
            />
          </div>
          <div>
            <Label htmlFor="compute-target-ssh-port">SSH port</Label>
            <Input
              id="compute-target-ssh-port"
              value={sshPort}
              inputMode="numeric"
              onChange={(event) => setSshPort(event.target.value)}
              disabled={isCreating || Boolean(enrollment)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="compute-target-identity-file">SSH key path</Label>
          <Input
            id="compute-target-identity-file"
            value={identityFile}
            placeholder="~/.ssh/id_ed25519"
            onChange={(event) => setIdentityFile(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
          />
        </div>
        <div>
          <Label htmlFor="compute-target-runtime-port">Remote AnyHarness port</Label>
          <Input
            id="compute-target-runtime-port"
            value={remoteAnyHarnessPort}
            inputMode="numeric"
            onChange={(event) => setRemoteAnyHarnessPort(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
          />
        </div>
        <div>
          <Label htmlFor="compute-target-root">Default workspace root</Label>
          <Input
            id="compute-target-root"
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
          />
        </div>
        {!enrollment && (
          <Button
            type="submit"
            loading={isCreating}
            disabled={!displayName.trim() || !sshHost.trim() || !sshUser.trim()}
          >
            Create enrollment command
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {enrollment && <EnrollmentCommandBlock command={enrollment.installCommand} />}
      </form>
    </ModalShell>
  );
}
