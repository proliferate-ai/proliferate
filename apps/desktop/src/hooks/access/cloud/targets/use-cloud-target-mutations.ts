import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveTarget,
  createExistingTargetEnrollment,
  createTargetEnrollment,
  getTarget,
  type ArchiveCloudTargetResponse,
  type CloudTargetExistingEnrollmentRequest,
  type CloudTargetEnrollmentRequest,
  type CloudTargetEnrollmentResponse,
} from "@proliferate/cloud-sdk";
import "@/lib/access/cloud/client";
import { cloudTargetKey, cloudTargetsKey } from "./query-keys";

export function useCloudTargetMutations() {
  const queryClient = useQueryClient();
  const createEnrollment = useMutation<
    CloudTargetEnrollmentResponse,
    Error,
    CloudTargetEnrollmentRequest
  >({
    mutationFn: (body) => createTargetEnrollment(body),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudTargetsKey() }),
        queryClient.invalidateQueries({ queryKey: cloudTargetKey(result.target.id) }),
      ]);
    },
  });
  const archive = useMutation<ArchiveCloudTargetResponse, Error, string>({
    mutationFn: (targetId) => archiveTarget(targetId),
    onSuccess: async (_result, targetId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudTargetsKey() }),
        queryClient.invalidateQueries({ queryKey: cloudTargetKey(targetId) }),
      ]);
    },
  });
  const createExistingEnrollment = useMutation<
    CloudTargetEnrollmentResponse,
    Error,
    { targetId: string; body?: CloudTargetExistingEnrollmentRequest }
  >({
    mutationFn: ({ targetId, body }) => createExistingTargetEnrollment(targetId, body),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cloudTargetsKey() }),
        queryClient.invalidateQueries({ queryKey: cloudTargetKey(result.target.id) }),
      ]);
    },
  });
  const invalidateTargets = async (targetId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: cloudTargetsKey() }),
      targetId
        ? queryClient.invalidateQueries({ queryKey: cloudTargetKey(targetId) })
        : Promise.resolve(),
    ]);
  };
  return {
    createTargetEnrollment: createEnrollment.mutateAsync,
    isCreatingTargetEnrollment: createEnrollment.isPending,
    createExistingTargetEnrollment: createExistingEnrollment.mutateAsync,
    isCreatingExistingTargetEnrollment: createExistingEnrollment.isPending,
    archiveTarget: archive.mutateAsync,
    isArchivingTarget: archive.isPending,
    getTarget,
    invalidateTargets,
  };
}
