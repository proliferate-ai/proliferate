import { useState } from "react";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import { setSshDirectTargetProfile } from "@/lib/access/tauri/ssh-target-profile";

interface StartSshEnrollmentInput {
  displayName: string;
  defaultWorkspaceRoot?: string | null;
  directAccess?: {
    sshHost: string;
    sshUser: string;
    sshPort: number;
    identityFile?: string | null;
    remoteAnyHarnessPort: number;
  } | null;
}

interface ComputeTargetEnrollmentResult {
  installCommand: string;
  targetId: string;
}

export function useComputeTargetEnrollment() {
  const { createTargetEnrollment, isCreatingTargetEnrollment } = useCloudTargetMutations();
  const [result, setResult] = useState<ComputeTargetEnrollmentResult | null>(null);

  return {
    enrollment: result,
    isCreating: isCreatingTargetEnrollment,
    clearEnrollment: () => setResult(null),
    startSshEnrollment: async (input: StartSshEnrollmentInput) => {
      const next = await createTargetEnrollment({
        displayName: input.displayName,
        kind: "ssh",
        ownerScope: "personal",
        defaultWorkspaceRoot: input.defaultWorkspaceRoot ?? null,
      });
      if (input.directAccess) {
        await setSshDirectTargetProfile({
          targetId: next.target.id,
          ...input.directAccess,
        });
      }
      const result = {
        installCommand: next.installCommand,
        targetId: next.target.id,
      };
      setResult(result);
      return result;
    },
  };
}
