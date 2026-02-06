"use client";

import { orpc } from "@/lib/orpc";
import type { UpdateScheduleInput } from "@proliferate/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useSchedule(id: string) {
	return useQuery({
		...orpc.schedules.get.queryOptions({ input: { id } }),
		enabled: !!id,
		select: (data) => data.schedule,
	});
}

export function useUpdateSchedule() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.schedules.update.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: orpc.schedules.get.key({ input: { id: variables.id } }),
			});
			// Also invalidate automations list if schedules are shown there
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
		},
	});

	const mutateAsync = async (id: string, data: UpdateScheduleInput) => {
		const result = await mutation.mutateAsync({ id, ...data });
		return result.schedule;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string, data: UpdateScheduleInput) => {
			mutation.mutate({ id, ...data });
		},
	};
}

export function useDeleteSchedule() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.schedules.delete.mutationOptions(),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({
				queryKey: orpc.schedules.get.key({ input: { id: variables.id } }),
			});
			// Also invalidate automations list if schedules are shown there
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
		},
	});

	const mutateAsync = async (id: string) => {
		const result = await mutation.mutateAsync({ id });
		return result.success;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string) => {
			mutation.mutate({ id });
		},
	};
}
