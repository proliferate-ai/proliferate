"use client";

import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ============================================
// Queries
// ============================================

export function useWorkerJobs(workerId: string) {
	return useQuery({
		...orpc.automations.listWorkerJobs.queryOptions({
			input: { workerId },
		}),
		enabled: !!workerId,
		select: (data) => data.jobs,
	});
}

export function useWorkerJob(jobId: string) {
	return useQuery({
		...orpc.automations.getWorkerJob.queryOptions({
			input: { jobId },
		}),
		enabled: !!jobId,
		select: (data) => data.job,
	});
}

// ============================================
// Mutations
// ============================================

export function useCreateWorkerJob(workerId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.createWorkerJob.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkerJobs.key({ input: { workerId } }),
			});
		},
	});
}

export function useUpdateWorkerJob(workerId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.updateWorkerJob.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkerJobs.key({ input: { workerId } }),
			});
		},
	});
}

export function useDeleteWorkerJob(workerId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.deleteWorkerJob.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkerJobs.key({ input: { workerId } }),
			});
		},
	});
}

export function useToggleWorkerJob(workerId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.updateWorkerJob.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkerJobs.key({ input: { workerId } }),
			});
		},
	});
}
