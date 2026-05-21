import { useState } from "react";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import {
  setComputeTargetAppearancePreference,
  setSshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";
import type {
  ComputeTargetColorId,
  ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";

interface StartSshEnrollmentInput {
  displayName: string;
  ownerScope?: "personal" | "organization";
  organizationId?: string | null;
  defaultWorkspaceRoot?: string | null;
  directAccess?: {
    sshHost: string;
    sshUser: string;
    sshPort: number;
    identityFile?: string | null;
    remoteAnyHarnessPort: number;
    workspaceRoot?: string | null;
  } | null;
  appearance?: {
    iconId: ComputeTargetIconId;
    colorId: ComputeTargetColorId;
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
        ownerScope: input.ownerScope ?? "personal",
        organizationId: input.ownerScope === "organization" ? input.organizationId ?? null : null,
        defaultWorkspaceRoot: input.defaultWorkspaceRoot ?? null,
      });
      if (input.directAccess) {
        await setSshDirectTargetProfile({
          targetId: next.target.id,
          ...input.directAccess,
        });
      }
      if (input.appearance) {
        await setComputeTargetAppearancePreference({
          targetId: next.target.id,
          displayName: input.displayName,
          iconId: input.appearance.iconId,
          colorId: input.appearance.colorId,
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
