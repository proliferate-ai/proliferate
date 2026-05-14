import { useState } from "react";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";

interface StartSshEnrollmentInput {
  displayName: string;
  defaultWorkspaceRoot?: string | null;
}

interface ComputeTargetEnrollmentResult {
  installCommand: string;
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
      setResult(next);
      return next;
    },
  };
}
