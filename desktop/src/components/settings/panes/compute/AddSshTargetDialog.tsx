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
    void startSshEnrollment({
      displayName,
      defaultWorkspaceRoot: workspaceRoot,
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
          <Label htmlFor="compute-target-root">Default workspace root</Label>
          <Input
            id="compute-target-root"
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            disabled={isCreating || Boolean(enrollment)}
          />
        </div>
        {!enrollment && (
          <Button type="submit" loading={isCreating} disabled={!displayName.trim()}>
            Create enrollment command
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {enrollment && <EnrollmentCommandBlock command={enrollment.installCommand} />}
      </form>
    </ModalShell>
  );
}
