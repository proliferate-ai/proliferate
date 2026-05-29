import { useState } from "react";
import { useCloudTargetMutations } from "@/hooks/access/cloud/targets/use-cloud-target-mutations";
import {
  setComputeTargetAppearancePreference,
  setSshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";
import {
  ensureSshAnyHarnessTunnel,
  installSshTargetRuntime,
  probeSshTargetConnection,
} from "@/lib/access/tauri/ssh-tunnel";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import {
  runSshTargetConnectWorkflow,
  type SshTargetConnectDeps,
  type SshTargetConnectPhaseState,
} from "@/lib/workflows/compute/ssh-target-connect-workflow";
import type { CloudTargetExistingEnrollmentRequest } from "@proliferate/cloud-sdk";
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

interface ReconnectSshTargetInput extends Omit<StartSshEnrollmentInput, "ownerScope" | "organizationId"> {
  targetId: string;
  ownerScope?: "personal" | "organization";
  organizationId?: string | null;
}

interface ComputeTargetEnrollmentResult {
  installCommand: string;
  localUrl?: string | null;
  targetId: string;
}

export function useComputeTargetEnrollment() {
  const {
    createTargetEnrollment,
    createExistingTargetEnrollment,
    getTarget,
    invalidateTargets,
    isCreatingTargetEnrollment,
    isCreatingExistingTargetEnrollment,
  } = useCloudTargetMutations();
  const [result, setResult] = useState<ComputeTargetEnrollmentResult | null>(null);
  const [phaseState, setPhaseState] = useState<SshTargetConnectPhaseState | null>(null);
  const [running, setRunning] = useState(false);

  function workflowDeps(onPhase: (state: SshTargetConnectPhaseState) => void): SshTargetConnectDeps {
    return {
      createTargetEnrollment,
      createExistingTargetEnrollment: (
        targetId: string,
        body: CloudTargetExistingEnrollmentRequest,
      ) => createExistingTargetEnrollment({ targetId, body }),
      saveDirectProfile: setSshDirectTargetProfile,
      saveAppearance: setComputeTargetAppearancePreference,
      probeSsh: probeSshTargetConnection,
      installRuntime: installSshTargetRuntime,
      getTarget,
      verifyTunnel: ensureSshAnyHarnessTunnel,
      onPhase,
      onEnrollment: (enrollment, manualInstallCommand) => {
        setResult({
          installCommand: manualInstallCommand,
          targetId: enrollment.target.id,
        });
      },
    };
  }

  async function runConnect(input: StartSshEnrollmentInput & { existingTargetId?: string | null }) {
    if (!input.directAccess) {
      throw new Error("SSH connection details are required.");
    }
    setRunning(true);
    try {
      const ownerScope = input.ownerScope ?? "personal";
      const connected = await runSshTargetConnectWorkflow({
        existingTargetId: input.existingTargetId ?? null,
        createRequest: {
          displayName: input.displayName,
          kind: "ssh",
          ownerScope,
          organizationId: ownerScope === "organization" ? input.organizationId ?? null : null,
          defaultWorkspaceRoot: input.defaultWorkspaceRoot ?? null,
        },
        existingEnrollmentRequest: input.existingTargetId ? {} : undefined,
        directAccess: {
          targetId: input.existingTargetId ?? "pending",
          ...input.directAccess,
        },
        appearance: input.appearance
          ? {
            targetId: input.existingTargetId ?? "pending",
            displayName: input.displayName,
            iconId: input.appearance.iconId,
            colorId: input.appearance.colorId,
          }
          : null,
        cloudBaseUrl: getProliferateApiBaseUrl(),
      }, workflowDeps(setPhaseState));
      const nextResult = {
        installCommand: connected.manualInstallCommand,
        localUrl: connected.tunnel?.localUrl ?? null,
        targetId: connected.enrollment.target.id,
      };
      setResult(nextResult);
      await invalidateTargets(nextResult.targetId);
      return nextResult;
    } finally {
      setRunning(false);
    }
  }

  return {
    enrollment: result,
    phaseState,
    isCreating: isCreatingTargetEnrollment || isCreatingExistingTargetEnrollment || running,
    clearEnrollment: () => {
      setResult(null);
      setPhaseState(null);
    },
    startSshEnrollment: async (input: StartSshEnrollmentInput) => runConnect(input),
    reconnectSshTarget: async (input: ReconnectSshTargetInput) =>
      runConnect({
        ...input,
        existingTargetId: input.targetId,
      }),
  };
}
