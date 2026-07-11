import { useEffect, useMemo, useState } from "react";
import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import {
  isBindableSessionCandidate,
  isExistingSessionChoice,
} from "@proliferate/product-domain/workflows/run-launch";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  initialWorkflowRunArgValues,
  resolvedWorkflowRunArgs,
  workflowRunSessionBindings,
  type WorkflowRunArgValue,
  type WorkflowRunSessionCandidate,
  type WorkflowRunSlotOption,
  type WorkflowRunSubmit,
  type WorkflowRunTargetOption,
} from "@/lib/domain/workflows/run-args-model";

interface UseWorkflowRunArgsFormInput {
  args: readonly WorkflowInputSpec[];
  localWorkspaces: readonly WorkflowRunTargetOption[];
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  slots?: readonly WorkflowRunSlotOption[];
  sessionCandidates?: readonly WorkflowRunSessionCandidate[];
  defaultLocalWorkspaceId?: string | null;
  defaultTargetMode?: WorkflowTargetMode | null;
  defaultCloudWorkspaceId?: string | null;
  onSubmit: (input: WorkflowRunSubmit) => void;
}

export function useWorkflowRunArgsForm(input: UseWorkflowRunArgsFormInput) {
  const {
    args,
    localWorkspaces,
    cloudWorkspaces,
    slots,
    sessionCandidates,
    defaultLocalWorkspaceId,
    defaultTargetMode,
    defaultCloudWorkspaceId,
    onSubmit,
  } = input;
  const initial = useMemo(() => initialWorkflowRunArgValues(args), [args]);
  const cloudAvailable = cloudWorkspaces.length > 0;
  const [values, setValues] = useState<Record<string, WorkflowRunArgValue>>(initial);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [targetMode, setTargetMode] = useState<WorkflowTargetMode>(() => {
    if (defaultTargetMode === "personal_cloud" && cloudAvailable) {
      return "personal_cloud";
    }
    if (!defaultTargetMode && localWorkspaces.length === 0 && cloudAvailable) {
      return "personal_cloud";
    }
    return "local";
  });
  const [localWorkspaceId, setLocalWorkspaceId] = useState(
    () =>
      (defaultLocalWorkspaceId && localWorkspaces.some((workspace) => workspace.id === defaultLocalWorkspaceId)
        ? defaultLocalWorkspaceId
        : localWorkspaces[0]?.id) ?? "",
  );
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState(
    () =>
      (defaultCloudWorkspaceId && cloudWorkspaces.some((workspace) => workspace.id === defaultCloudWorkspaceId)
        ? defaultCloudWorkspaceId
        : cloudWorkspaces[0]?.id) ?? "",
  );
  const activeWorkspaceKey =
    targetMode === "local"
      ? localWorkspaceId || null
      : cloudWorkspaceId
        ? cloudWorkspaceSyntheticId(cloudWorkspaceId)
        : null;
  const candidatesBySlot = useMemo(() => {
    const candidates = new Map<string, WorkflowRunSessionCandidate[]>();
    for (const slot of slots ?? []) {
      candidates.set(
        slot.slot,
        (sessionCandidates ?? []).filter((candidate) =>
          isBindableSessionCandidate(candidate, { harness: slot.harness, workspaceKey: activeWorkspaceKey }),
        ),
      );
    }
    return candidates;
  }, [slots, sessionCandidates, activeWorkspaceKey]);
  const bindableSlots = useMemo(
    () => (slots ?? []).filter((slot) => (candidatesBySlot.get(slot.slot)?.length ?? 0) > 0),
    [slots, candidatesBySlot],
  );

  useEffect(() => {
    setBindings((previous) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [slot, sessionId] of Object.entries(previous)) {
        if (candidatesBySlot.get(slot)?.some((candidate) => candidate.id === sessionId)) {
          next[slot] = sessionId;
        } else {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [candidatesBySlot]);

  const setValue = (name: string, value: WorkflowRunArgValue) => {
    setValues((previous) => ({ ...previous, [name]: value }));
  };
  const setSlotBinding = (slot: string, sessionId: string) => {
    setBindings((previous) => ({ ...previous, [slot]: sessionId }));
  };
  const missingRequired = args.some(
    (arg) => arg.required && (values[arg.name] === "" || values[arg.name] === undefined),
  );
  const missingTarget = targetMode === "local" ? localWorkspaceId === "" : cloudWorkspaceId === "";
  const boundCount = (slots ?? []).filter((slot) => isExistingSessionChoice(bindings[slot.slot])).length;
  const targetOptions = targetMode === "local" ? localWorkspaces : cloudWorkspaces;
  const submit = () => {
    onSubmit({
      args: resolvedWorkflowRunArgs(args, values),
      targetMode,
      localWorkspaceId: targetMode === "local" ? localWorkspaceId : undefined,
      cloudWorkspaceId: targetMode === "personal_cloud" ? cloudWorkspaceId : undefined,
      sessionBindings: workflowRunSessionBindings(slots ?? [], bindings),
    });
  };

  return {
    bindableSlots,
    bindings,
    boundCount,
    candidatesBySlot,
    cloudAvailable,
    cloudWorkspaceId,
    localWorkspaceId,
    missingRequired,
    missingTarget,
    setCloudWorkspaceId,
    setLocalWorkspaceId,
    setSlotBinding,
    setTargetMode,
    setValue,
    submit,
    targetMode,
    targetOptions,
    values,
  };
}
