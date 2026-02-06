"use client";

import { orpc } from "@/lib/orpc";
import type { CreateTriggerInput, UpdateTriggerInput } from "@proliferate/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useTriggers() {
	return useQuery({
		...orpc.triggers.list.queryOptions({ input: {} }),
		select: (data) => data.triggers,
	});
}

export function useTrigger(id: string) {
	return useQuery({
		...orpc.triggers.get.queryOptions({ input: { id } }),
		enabled: !!id,
		select: (data) => ({
			trigger: data.trigger,
			recentEvents: data.recentEvents,
			eventCounts: data.eventCounts,
		}),
	});
}

export function useCreateTrigger() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.triggers.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.triggers.list.key() });
		},
	});

	const mutateAsync = async (data: CreateTriggerInput) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CreateTriggerInput) => {
			mutation.mutate(data);
		},
	};
}

export function useUpdateTrigger() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.triggers.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.triggers.list.key() });
		},
	});

	const mutateAsync = async (id: string, data: UpdateTriggerInput) => {
		const result = await mutation.mutateAsync({ id, ...data });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string, data: UpdateTriggerInput) => {
			mutation.mutate({ id, ...data });
		},
	};
}

export function useDeleteTrigger() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.triggers.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.triggers.list.key() });
		},
	});

	const mutateAsync = async (id: string) => {
		const result = await mutation.mutateAsync({ id });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string) => {
			mutation.mutate({ id });
		},
	};
}

interface UseTriggerEventsOptions {
	triggerId?: string;
	status?: string;
	limit?: number;
	offset?: number;
}

export function useTriggerEvents(options: UseTriggerEventsOptions = {}) {
	const { triggerId, status, limit, offset } = options;

	return useQuery({
		...orpc.triggers.listEvents.queryOptions({
			input: { triggerId, status, limit, offset },
		}),
		select: (data) => ({
			events: data.events,
			total: data.total,
			limit: data.limit,
			offset: data.offset,
		}),
	});
}

export function useSkipTriggerEvent() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.triggers.skipEvent.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.triggers.listEvents.key() });
			queryClient.invalidateQueries({ queryKey: orpc.triggers.list.key() });
		},
	});

	const mutateAsync = async (id: string) => {
		const result = await mutation.mutateAsync({ id });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string) => {
			mutation.mutate({ id });
		},
	};
}
