import { useState, type CSSProperties, type FormEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Select } from "@/components/ui/Select";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useComputeTargetEnrollment } from "@/hooks/settings/workflows/use-compute-target-enrollment";
import {
  COMPUTE_TARGET_COLOR_OPTIONS,
  COMPUTE_TARGET_ICON_OPTIONS,
  type ComputeTargetColorId,
  type ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import { ComputeTargetIconGlyph } from "./ComputeTargetSwatch";
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
            {COMPUTE_COPY.createEnrollmentCommand}
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {enrollment && <EnrollmentCommandBlock command={enrollment.installCommand} />}
      </form>
    </ModalShell>
  );
}
