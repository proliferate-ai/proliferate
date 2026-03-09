"use client";

import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useCreateWorkerSlackChannel(workerId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.createWorkerSlackChannel.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getWorker.key({ input: { id: workerId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkers.key(),
			});
		},
	});
}

export function useRemoveWorkerSlackChannel(workerId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.removeWorkerSlackChannel.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getWorker.key({ input: { id: workerId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listWorkers.key(),
			});
		},
	});
}
