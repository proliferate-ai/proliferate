"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ============================================
// Worker List & Detail
// ============================================

export function useWorkers() {
	return useQuery({
		...orpc.automations.listWorkers.queryOptions({ input: undefined }),
		select: (data) => data.workers,
	});
}

export function useWorker(id: string) {
	return useQuery({
		...orpc.automations.getWorker.queryOptions({ input: { id } }),
		enabled: !!id,
		select: (data) => data.worker,
	});
}

// ============================================
// Worker Runs & Events
// ============================================

export function useWorkerRuns(
	workerId: string,
	options?: { limit?: number; pollingEnabled?: boolean },
) {
	return useQuery({
		...orpc.automations.listWorkerRuns.queryOptions({
			input: { workerId, limit: options?.limit },
		}),
		enabled: !!workerId,
		refetchInterval: options?.pollingEnabled ? 5000 : false,
		select: (data) => data.runs,
	});
}

// ============================================
// Worker Sessions
// ============================================

export function useWorkerSessions(
	workerId: string,
	options?: { limit?: number; pollingEnabled?: boolean },
) {
	return useQuery({
		...orpc.automations.listWorkerSessions.queryOptions({
			input: { workerId, limit: options?.limit },
		}),
		enabled: !!workerId,
		refetchInterval: options?.pollingEnabled ? 5000 : false,
		select: (data) => data.sessions,
	});
}

// ============================================
// Pending Directives
// ============================================

export function usePendingDirectives(workerId: string) {
	return useQuery({
		...orpc.automations.listPendingDirectives.queryOptions({
			input: { workerId },
		}),
		enabled: !!workerId,
		select: (data) => data.directives,
	});
}

// ============================================
// Mutations
// ============================================

export function useSendDirective(workerId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.sendDirective.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listPendingDirectives.key({ input: { workerId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkerRuns.key({ input: { workerId } }),
			});
		},
	});
}

export function usePauseWorker() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.pauseWorker.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getWorker.key({ input: { id: variables.workerId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkers.key(),
			});
		},
	});
}

export function useResumeWorker() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.resumeWorker.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getWorker.key({ input: { id: variables.workerId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkers.key(),
			});
		},
	});
}

export function useRunWorkerNow() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.runWorkerNow.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkerRuns.key({ input: { workerId: variables.workerId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getWorker.key({ input: { id: variables.workerId } }),
			});
		},
	});
}

export function useUpdateWorker(workerId: string) {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.updateWorker.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getWorker.key({ input: { id: workerId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkers.key(),
			});
		},
	});

	const mutateAsync = async (fields: {
		name?: string;
		objective?: string;
		modelId?: string;
	}) => {
		const result = await mutation.mutateAsync({ id: workerId, ...fields });
		return result.worker;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (fields: { name?: string; objective?: string; modelId?: string }) => {
			mutation.mutate({ id: workerId, ...fields });
		},
	};
}

export function useDeleteWorker() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.deleteWorker.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkers.key(),
			});
		},
	});
}
