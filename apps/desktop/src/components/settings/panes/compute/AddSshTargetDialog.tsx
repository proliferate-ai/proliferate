import { useState, type CSSProperties, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Select } from "@proliferate/ui/primitives/Select";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useComputeTargetEnrollment } from "@/hooks/settings/workflows/use-compute-target-enrollment";
import {
  COMPUTE_TARGET_COLOR_OPTIONS,
  COMPUTE_TARGET_ICON_OPTIONS,
  type ComputeTargetColorId,
  type ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";
import type { SshTargetConnectPhase } from "@/lib/workflows/compute/ssh-target-connect-workflow";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { ComputeTargetIconGlyph } from "@/components/compute/ComputeTargetSwatch";
import { EnrollmentCommandBlock } from "./EnrollmentCommandBlock";

interface AddSshTargetDialogProps {
  open: boolean;
  onClose: () => void;
  onTargetAppearanceSaved?: () => void;
}

export function AddSshTargetDialog({
  open,
  onClose,
  onTargetAppearanceSaved,
}: AddSshTargetDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("~/proliferate-workspaces");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [remoteAnyHarnessPort, setRemoteAnyHarnessPort] = useState("8457");
  const [ownerScope, setOwnerScope] = useState<"personal" | "organization">("personal");
  const [iconId, setIconId] = useState<ComputeTargetIconId>("monitor");
  const [colorId, setColorId] = useState<ComputeTargetColorId>("blue");
  const [error, setError] = useState<string | null>(null);
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const canCreateOrganizationTarget = Boolean(activeOrganizationId && admin.isAdmin);
  const {
    enrollment,
    phaseState,
    isCreating,
    clearEnrollment,
    startSshEnrollment,
  } = useComputeTargetEnrollment();
  const connected = phaseState?.phase === "connected";
  const failed = phaseState?.phase === "failed";

  const close = () => {
    clearEnrollment();
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const effectiveOwnerScope = canCreateOrganizationTarget ? ownerScope : "personal";
    const parsedSshPort = Number.parseInt(sshPort, 10);
    const parsedRuntimePort = Number.parseInt(remoteAnyHarnessPort, 10);
    void startSshEnrollment({
      displayName,
      ownerScope: effectiveOwnerScope,
      organizationId: effectiveOwnerScope === "organization" ? activeOrganizationId : null,
      defaultWorkspaceRoot: workspaceRoot,
      directAccess: {
        sshHost,
        sshUser,
        sshPort: Number.isFinite(parsedSshPort) ? parsedSshPort : 22,
        identityFile: identityFile.trim() || null,
        remoteAnyHarnessPort: Number.isFinite(parsedRuntimePort) ? parsedRuntimePort : 8457,
        workspaceRoot,
      },
      appearance: {
        iconId,
        colorId,
      },
    }).then(() => {
      onTargetAppearanceSaved?.();
    }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Could not create enrollment.");
    });
  };

  return (
    <ModalShell
      open={open}
      onClose={close}
      title="Connect SSH target"
      description="Enter SSH details once. Desktop will install the target runtime and verify the connection."
      sizeClassName="max-w-2xl"
      footer={(
        <Button type="button" variant="outline" onClick={close}>
          {connected ? "Done" : "Cancel"}
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
        {canCreateOrganizationTarget && (
          <div>
            <Label htmlFor="compute-target-scope">Target scope</Label>
            <Select
              id="compute-target-scope"
              value={ownerScope}
              onChange={(event) =>
                setOwnerScope(event.target.value === "organization" ? "organization" : "personal")}
              disabled={isCreating || Boolean(enrollment)}
            >
              <option value="personal">Personal cloud</option>
              <option value="organization">
                {activeOrganization ? `${activeOrganization.name} shared cloud` : "Team cloud"}
              </option>
            </Select>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              Team targets can be used by shared automations, Slack, and claimed shared workspaces.
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
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
                  disabled={isCreating || Boolean(enrollment)}
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
                    disabled={isCreating || Boolean(enrollment)}
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
            {COMPUTE_COPY.connectTarget}
          </Button>
        )}
        {phaseState && (
          <div className="rounded-md border border-border/60 bg-foreground/5 p-3 text-sm">
            <div className="font-medium text-foreground">{phaseState.label}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {phaseHelp(phaseState.phase)}
            </p>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {connected && enrollment?.localUrl && (
          <p className="text-sm text-muted-foreground">
            {COMPUTE_COPY.connectSuccess} {enrollment.localUrl}.
          </p>
        )}
        {connected && enrollment && !enrollment.localUrl && (
          <p className="text-sm text-muted-foreground">
            {COMPUTE_COPY.connectSuccessNoTunnel}
          </p>
        )}
        {failed && enrollment && !isCreating && (
          <EnrollmentCommandBlock command={enrollment.installCommand} />
        )}
      </form>
    </ModalShell>
  );
}

function phaseHelp(phase: SshTargetConnectPhase): string {
  switch (phase) {
    case "checking_ssh":
      return "Checking that this Desktop can reach the target over SSH.";
    case "creating_enrollment":
      return "Preparing the Cloud target record and single-use worker enrollment.";
    case "saving_profile":
      return "Saving SSH connection details locally on this Desktop.";
    case "installing_runtime":
      return "Streaming the Proliferate installer to the target over SSH.";
    case "waiting_for_worker":
      return "Waiting for the remote worker to enroll and report inventory.";
    case "verifying_desktop_access":
      return "Opening an SSH tunnel to the target AnyHarness runtime.";
    case "connected":
      return "The target is connected and ready for launch preflight checks.";
    case "failed":
      return "Automatic setup stopped. Use the recovery details below, or cancel and try again.";
    case "idle":
      return "Ready to connect.";
  }
}
