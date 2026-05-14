import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveTarget,
  createTargetEnrollment,
  type ArchiveCloudTargetResponse,
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
  return {
    createTargetEnrollment: createEnrollment.mutateAsync,
    isCreatingTargetEnrollment: createEnrollment.isPending,
    archiveTarget: archive.mutateAsync,
    isArchivingTarget: archive.isPending,
  };
}
